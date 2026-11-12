-- ── Enums ──────────────────────────────────────────────────────────────
CREATE TYPE public.app_role AS ENUM ('employee', 'hr_ops', 'security', 'super_admin');
CREATE TYPE public.zone_type AS ENUM ('WORKSPACE_FLOOR', 'CAFETERIA_LOUNGE', 'OUTDOOR_TERRACE', 'CORRIDOR_TRANSIT');
CREATE TYPE public.transit_direction AS ENUM ('ZONE_ENTER', 'ZONE_EXIT');

-- ── Roles (one enclave per person) ────────────────────────────────────
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;

CREATE OR REPLACE FUNCTION public.has_any_role(_user_id UUID, _roles public.app_role[])
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = ANY(_roles))
$$;

CREATE POLICY "Users read own role; admins read all" ON public.user_roles FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'super_admin'));
CREATE POLICY "Admins assign roles" ON public.user_roles FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'super_admin'));
CREATE POLICY "Admins change roles" ON public.user_roles FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'super_admin')) WITH CHECK (public.has_role(auth.uid(), 'super_admin'));
CREATE POLICY "Admins remove roles" ON public.user_roles FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'super_admin'));

-- Never leave the platform without a super admin
CREATE OR REPLACE FUNCTION public.protect_last_super_admin()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF OLD.role = 'super_admin' AND (TG_OP = 'DELETE' OR NEW.role <> 'super_admin') THEN
    IF (SELECT count(*) FROM public.user_roles WHERE role = 'super_admin') <= 1 THEN
      RAISE EXCEPTION 'At least one Super Admin must remain';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER user_roles_protect_last_admin BEFORE UPDATE OR DELETE ON public.user_roles
  FOR EACH ROW EXECUTE FUNCTION public.protect_last_super_admin();

-- ── Enterprise users (profiles; app id kept separate from sign-in id) ──
CREATE TABLE public.enterprise_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id UUID UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL,
  email TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  imported_role public.app_role,
  role_title TEXT NOT NULL DEFAULT 'Staff',
  badge_id TEXT UNIQUE NOT NULL,
  department TEXT NOT NULL DEFAULT 'Unassigned',
  avatar_url TEXT,
  current_zone public.zone_type DEFAULT 'CORRIDOR_TRANSIT',
  is_in_workspace BOOLEAN DEFAULT FALSE,
  enrolled_embedding JSONB,
  consent_revoked BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, UPDATE ON public.enterprise_users TO authenticated;
GRANT ALL ON public.enterprise_users TO service_role;
ALTER TABLE public.enterprise_users ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.current_enterprise_user_id()
RETURNS UUID LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id FROM public.enterprise_users WHERE auth_user_id = auth.uid()
$$;

CREATE POLICY "Self or staff read profiles" ON public.enterprise_users FOR SELECT TO authenticated
  USING (auth_user_id = auth.uid() OR public.has_any_role(auth.uid(), ARRAY['hr_ops','security','super_admin']::public.app_role[]));
CREATE POLICY "Admins edit profiles" ON public.enterprise_users FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'super_admin')) WITH CHECK (public.has_role(auth.uid(), 'super_admin'));

-- ── ESP32-CAM nodes ───────────────────────────────────────────────────
CREATE TABLE public.esp32_camera_nodes (
  id TEXT PRIMARY KEY,
  stream_url TEXT NOT NULL,
  boundary_name TEXT NOT NULL,
  zone_a public.zone_type NOT NULL,
  zone_b public.zone_type NOT NULL,
  is_online BOOLEAN NOT NULL DEFAULT FALSE,
  fps NUMERIC(4,1) NOT NULL DEFAULT 15.0,
  last_ping TIMESTAMPTZ
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.esp32_camera_nodes TO authenticated;
GRANT ALL ON public.esp32_camera_nodes TO service_role;
ALTER TABLE public.esp32_camera_nodes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Security and admin manage nodes" ON public.esp32_camera_nodes FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['security','super_admin']::public.app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['security','super_admin']::public.app_role[]));

-- ── Passive transits ──────────────────────────────────────────────────
CREATE TABLE public.passive_transits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.enterprise_users(id) ON DELETE CASCADE,
  "timestamp" TIMESTAMPTZ NOT NULL DEFAULT now(),
  camera_id TEXT REFERENCES public.esp32_camera_nodes(id) ON DELETE SET NULL,
  zone_from public.zone_type NOT NULL,
  zone_to public.zone_type NOT NULL,
  direction public.transit_direction NOT NULL,
  cosine_score NUMERIC(5,4) NOT NULL,
  dram_scrub_ms NUMERIC(4,1) NOT NULL,
  vector_hash TEXT NOT NULL
);
CREATE INDEX passive_transits_user_time ON public.passive_transits (user_id, "timestamp" DESC);
CREATE INDEX passive_transits_time ON public.passive_transits ("timestamp" DESC);
GRANT SELECT ON public.passive_transits TO authenticated;
GRANT ALL ON public.passive_transits TO service_role;
ALTER TABLE public.passive_transits ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Self or staff read transits" ON public.passive_transits FOR SELECT TO authenticated
  USING (user_id = public.current_enterprise_user_id()
    OR public.has_any_role(auth.uid(), ARRAY['hr_ops','security','super_admin']::public.app_role[]));

-- ── Daily dwell ───────────────────────────────────────────────────────
CREATE TABLE public.employee_daily_dwell (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.enterprise_users(id) ON DELETE CASCADE,
  record_date DATE NOT NULL DEFAULT CURRENT_DATE,
  workspace_minutes INT NOT NULL DEFAULT 0,
  break_minutes INT NOT NULL DEFAULT 0,
  continuous_workspace_minutes INT NOT NULL DEFAULT 0,
  last_transition_time TIMESTAMPTZ NOT NULL DEFAULT now(),
  osh_compliance_flag BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE (user_id, record_date)
);
GRANT SELECT ON public.employee_daily_dwell TO authenticated;
GRANT ALL ON public.employee_daily_dwell TO service_role;
ALTER TABLE public.employee_daily_dwell ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Self, HR or admin read dwell" ON public.employee_daily_dwell FOR SELECT TO authenticated
  USING (user_id = public.current_enterprise_user_id()
    OR public.has_any_role(auth.uid(), ARRAY['hr_ops','super_admin']::public.app_role[]));

-- ── Merkle audit ledger ───────────────────────────────────────────────
CREATE TABLE public.merkle_audit_blocks (
  block_height BIGINT PRIMARY KEY,
  "timestamp" TIMESTAMPTZ NOT NULL DEFAULT now(),
  root_hash TEXT NOT NULL,
  previous_hash TEXT NOT NULL,
  transaction_count INT NOT NULL,
  leaf_hashes TEXT[] NOT NULL DEFAULT '{}',
  validator_enclave TEXT NOT NULL,
  dilithium_signature TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'VERIFIED'
);
GRANT SELECT, INSERT ON public.merkle_audit_blocks TO authenticated;
GRANT ALL ON public.merkle_audit_blocks TO service_role;
ALTER TABLE public.merkle_audit_blocks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated personnel verify blocks" ON public.merkle_audit_blocks FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins anchor blocks" ON public.merkle_audit_blocks FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'super_admin'));

-- ── DPDP Sec. 12 erasure requests ─────────────────────────────────────
CREATE TABLE public.dpo_erasure_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.enterprise_users(id) ON DELETE SET NULL,
  requestor_name TEXT NOT NULL,
  email TEXT NOT NULL,
  badge_id TEXT NOT NULL,
  erasure_scope JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'SUBMITTED',
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  zeroization_proof_url TEXT
);
GRANT SELECT ON public.dpo_erasure_requests TO authenticated;
GRANT ALL ON public.dpo_erasure_requests TO service_role;
ALTER TABLE public.dpo_erasure_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Self or staff read erasure requests" ON public.dpo_erasure_requests FOR SELECT TO authenticated
  USING (user_id = public.current_enterprise_user_id()
    OR public.has_any_role(auth.uid(), ARRAY['hr_ops','security','super_admin']::public.app_role[]));

-- ── Sign-in linking: runs once the email address is verified ──────────
CREATE OR REPLACE FUNCTION public.handle_verified_auth_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _profile public.enterprise_users%ROWTYPE;
  _match_count INT;
  _role public.app_role;
  _name TEXT;
BEGIN
  IF NEW.email_confirmed_at IS NULL THEN RETURN NEW; END IF;
  IF EXISTS (SELECT 1 FROM public.enterprise_users WHERE auth_user_id = NEW.id) THEN RETURN NEW; END IF;

  SELECT count(*) INTO _match_count FROM public.enterprise_users
    WHERE lower(email) = lower(NEW.email) AND auth_user_id IS NULL;

  IF _match_count = 1 THEN
    UPDATE public.enterprise_users SET auth_user_id = NEW.id
      WHERE lower(email) = lower(NEW.email) AND auth_user_id IS NULL
      RETURNING * INTO _profile;
  ELSIF _match_count = 0 THEN
    _name := coalesce(nullif(trim(NEW.raw_user_meta_data->>'name'), ''), split_part(NEW.email, '@', 1));
    INSERT INTO public.enterprise_users (auth_user_id, email, name, badge_id, department, role_title, avatar_url)
    VALUES (
      NEW.id, NEW.email, _name,
      'PT-' || upper(substr(replace(NEW.id::text, '-', ''), 1, 6)),
      coalesce(nullif(trim(NEW.raw_user_meta_data->>'department'), ''), 'Unassigned'),
      coalesce(nullif(trim(NEW.raw_user_meta_data->>'role_title'), ''), 'Staff'),
      'https://ui-avatars.com/api/?name=' || replace(_name, ' ', '+') || '&background=10B981&color=fff&bold=true'
    ) RETURNING * INTO _profile;
  ELSE
    -- Ambiguous duplicate emails: leave unlinked for manual resolution
    RETURN NEW;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE role = 'super_admin') THEN
    _role := 'super_admin';
  ELSE
    _role := coalesce(_profile.imported_role, 'employee');
  END IF;
  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, _role) ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_verified
  AFTER INSERT OR UPDATE OF email_confirmed_at ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_verified_auth_user();

-- ── Transit side effects: zone + dwell accounting ─────────────────────
CREATE OR REPLACE FUNCTION public.apply_transit()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _prev_zone public.zone_type;
  _dwell public.employee_daily_dwell%ROWTYPE;
  _day DATE := (NEW."timestamp" AT TIME ZONE 'Asia/Kolkata')::date;
  _elapsed INT := 0;
  _continuous INT := 0;
BEGIN
  SELECT current_zone INTO _prev_zone FROM public.enterprise_users WHERE id = NEW.user_id;

  INSERT INTO public.employee_daily_dwell (user_id, record_date, last_transition_time)
    VALUES (NEW.user_id, _day, NEW."timestamp")
    ON CONFLICT (user_id, record_date) DO NOTHING;
  SELECT * INTO _dwell FROM public.employee_daily_dwell WHERE user_id = NEW.user_id AND record_date = _day;

  _elapsed := greatest(0, floor(extract(epoch FROM (NEW."timestamp" - _dwell.last_transition_time)) / 60)::int);
  _continuous := _dwell.continuous_workspace_minutes;

  IF _prev_zone = 'WORKSPACE_FLOOR' THEN
    _continuous := _continuous + _elapsed;
    UPDATE public.employee_daily_dwell SET workspace_minutes = workspace_minutes + _elapsed,
      continuous_workspace_minutes = CASE WHEN NEW.zone_to = 'WORKSPACE_FLOOR' THEN _continuous ELSE 0 END,
      osh_compliance_flag = osh_compliance_flag AND _continuous <= 270,
      last_transition_time = NEW."timestamp"
      WHERE id = _dwell.id;
  ELSE
    UPDATE public.employee_daily_dwell SET
      break_minutes = break_minutes + CASE WHEN _prev_zone IS NULL OR _prev_zone = 'CORRIDOR_TRANSIT' THEN 0 ELSE _elapsed END,
      continuous_workspace_minutes = 0,
      last_transition_time = NEW."timestamp"
      WHERE id = _dwell.id;
  END IF;

  UPDATE public.enterprise_users
    SET current_zone = NEW.zone_to, is_in_workspace = (NEW.zone_to = 'WORKSPACE_FLOOR')
    WHERE id = NEW.user_id;
  RETURN NEW;
END;
$$;
CREATE TRIGGER passive_transits_apply AFTER INSERT ON public.passive_transits
  FOR EACH ROW EXECUTE FUNCTION public.apply_transit();

-- ── DPDP actions ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.exercise_erasure(_scope TEXT[])
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _profile public.enterprise_users%ROWTYPE;
  _id UUID;
BEGIN
  SELECT * INTO _profile FROM public.enterprise_users WHERE auth_user_id = auth.uid();
  IF _profile.id IS NULL THEN RAISE EXCEPTION 'No enrolled profile for this account'; END IF;
  IF _scope IS NULL OR array_length(_scope, 1) IS NULL
     OR NOT (_scope <@ ARRAY['biometric_embeddings','transit_history','dwell_records','audit_ledger','compliant_backup']) THEN
    RAISE EXCEPTION 'Invalid erasure scope';
  END IF;
  UPDATE public.enterprise_users SET consent_revoked = TRUE WHERE id = _profile.id;
  INSERT INTO public.dpo_erasure_requests (user_id, requestor_name, email, badge_id, erasure_scope, status)
    VALUES (_profile.id, _profile.name, _profile.email, _profile.badge_id, to_jsonb(_scope), 'ZEROIZING')
    RETURNING id INTO _id;
  RETURN _id;
END;
$$;

CREATE OR REPLACE FUNCTION public.restore_consent()
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.enterprise_users SET consent_revoked = FALSE WHERE auth_user_id = auth.uid();
END;
$$;

CREATE OR REPLACE FUNCTION public.approve_erasure_request(_request_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _req public.dpo_erasure_requests%ROWTYPE;
BEGIN
  IF NOT public.has_role(auth.uid(), 'super_admin') THEN RAISE EXCEPTION 'Forbidden'; END IF;
  SELECT * INTO _req FROM public.dpo_erasure_requests WHERE id = _request_id;
  IF _req.id IS NULL THEN RAISE EXCEPTION 'Request not found'; END IF;
  IF _req.user_id IS NOT NULL THEN
    IF _req.erasure_scope ? 'biometric_embeddings' THEN
      UPDATE public.enterprise_users SET enrolled_embedding = NULL WHERE id = _req.user_id;
    END IF;
    IF _req.erasure_scope ? 'transit_history' THEN
      DELETE FROM public.passive_transits WHERE user_id = _req.user_id;
    END IF;
    IF _req.erasure_scope ? 'dwell_records' THEN
      DELETE FROM public.employee_daily_dwell WHERE user_id = _req.user_id;
    END IF;
  END IF;
  UPDATE public.dpo_erasure_requests SET status = 'VERIFIED_PURGED', completed_at = now() WHERE id = _request_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.exercise_erasure(TEXT[]) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.restore_consent() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.approve_erasure_request(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.exercise_erasure(TEXT[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.restore_consent() TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_erasure_request(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_role(UUID, public.app_role) TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_any_role(UUID, public.app_role[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_enterprise_user_id() TO authenticated;

-- ── Realtime ──────────────────────────────────────────────────────────
ALTER PUBLICATION supabase_realtime ADD TABLE public.passive_transits;
ALTER PUBLICATION supabase_realtime ADD TABLE public.esp32_camera_nodes;
ALTER PUBLICATION supabase_realtime ADD TABLE public.merkle_audit_blocks;

-- ── Seed: boundary nodes configured in the original console ───────────
INSERT INTO public.esp32_camera_nodes (id, stream_url, boundary_name, zone_a, zone_b, is_online, fps) VALUES
  ('ESP32-CAM-01-NORTH', 'http://192.168.1.150:81/stream', 'Corridor -> Workspace Floor', 'CORRIDOR_TRANSIT', 'WORKSPACE_FLOOR', FALSE, 15),
  ('ESP32-CAM-02-SOUTH', 'http://192.168.1.151:81/stream', 'Workspace Floor -> Cafeteria/Lounge', 'WORKSPACE_FLOOR', 'CAFETERIA_LOUNGE', FALSE, 15),
  ('ESP32-CAM-03-EAST', 'http://192.168.1.152:81/stream', 'Floor 3 R&D Entry / Elevator Lobby', 'CORRIDOR_TRANSIT', 'WORKSPACE_FLOOR', FALSE, 15),
  ('ESP32-CAM-04-SKY', 'http://192.168.1.153:81/stream', 'Inter-Floor Skybridge Link', 'WORKSPACE_FLOOR', 'WORKSPACE_FLOOR', FALSE, 15);
