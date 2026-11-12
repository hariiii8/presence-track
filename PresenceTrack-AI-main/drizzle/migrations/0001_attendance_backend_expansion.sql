-- ============================================================================
-- Migration: 0001_attendance_backend_expansion
-- Creates: departments, attendance_records, admin_audit_logs, unknown_detections
-- Updates: enterprise_users, esp32_camera_nodes, apply_transit()
-- ============================================================================

-- ── 1. Departments Table ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.departments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT ON public.departments TO authenticated;
GRANT ALL ON public.departments TO service_role;
ALTER TABLE public.departments ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "Authenticated users view departments" ON public.departments
    FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE POLICY "Admins manage departments" ON public.departments
    FOR ALL TO authenticated
    USING (public.has_role(auth.uid(), 'super_admin'))
    WITH CHECK (public.has_role(auth.uid(), 'super_admin'));
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ── 2. Extend enterprise_users ──────────────────────────────────────────────
ALTER TABLE public.enterprise_users
  ADD COLUMN IF NOT EXISTS department_id UUID REFERENCES public.departments(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS employment_type TEXT NOT NULL DEFAULT 'FULL_TIME',
  ADD COLUMN IF NOT EXISTS shift_start TIME NOT NULL DEFAULT '09:00:00',
  ADD COLUMN IF NOT EXISTS shift_end TIME NOT NULL DEFAULT '18:00:00';

-- ── 3. Attendance Status & Attendance Records Table ──────────────────────────
DO $$ BEGIN
  CREATE TYPE public.attendance_status AS ENUM ('PRESENT', 'ABSENT', 'HALF_DAY', 'ON_LEAVE', 'HOLIDAY');
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE TABLE IF NOT EXISTS public.attendance_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES public.enterprise_users(id) ON DELETE CASCADE,
  attendance_date DATE NOT NULL DEFAULT CURRENT_DATE,
  first_in TIMESTAMPTZ,
  last_out TIMESTAMPTZ,
  total_work_minutes INT NOT NULL DEFAULT 0,
  total_break_minutes INT NOT NULL DEFAULT 0,
  status public.attendance_status NOT NULL DEFAULT 'PRESENT',
  missed_exit BOOLEAN NOT NULL DEFAULT false,
  anomaly_reason TEXT,
  is_manual_entry BOOLEAN NOT NULL DEFAULT false,
  approved_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (employee_id, attendance_date)
);

CREATE INDEX IF NOT EXISTS attendance_records_emp_date ON public.attendance_records (employee_id, attendance_date DESC);
CREATE INDEX IF NOT EXISTS attendance_records_date ON public.attendance_records (attendance_date DESC);

GRANT SELECT, INSERT, UPDATE ON public.attendance_records TO authenticated;
GRANT ALL ON public.attendance_records TO service_role;
ALTER TABLE public.attendance_records ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "Users read own attendance; HR and Admin read all" ON public.attendance_records
    FOR SELECT TO authenticated
    USING (
      employee_id = public.current_enterprise_user_id()
      OR public.has_any_role(auth.uid(), ARRAY['hr_ops', 'super_admin']::public.app_role[])
    );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE POLICY "HR and Admin manage attendance" ON public.attendance_records
    FOR ALL TO authenticated
    USING (public.has_any_role(auth.uid(), ARRAY['hr_ops', 'super_admin']::public.app_role[]))
    WITH CHECK (public.has_any_role(auth.uid(), ARRAY['hr_ops', 'super_admin']::public.app_role[]));
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ── 4. Admin Audit Logs Table ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.admin_audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS admin_audit_logs_created_at ON public.admin_audit_logs (created_at DESC);
GRANT SELECT, INSERT ON public.admin_audit_logs TO authenticated;
GRANT ALL ON public.admin_audit_logs TO service_role;
ALTER TABLE public.admin_audit_logs ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "Admins read audit logs" ON public.admin_audit_logs
    FOR SELECT TO authenticated
    USING (public.has_role(auth.uid(), 'super_admin'));
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE POLICY "Admins insert audit logs" ON public.admin_audit_logs
    FOR INSERT TO authenticated
    WITH CHECK (auth.uid() = actor_id);
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ── 5. Unknown Detections Table ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.unknown_detections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id TEXT REFERENCES public.esp32_camera_nodes(id) ON DELETE SET NULL,
  zone_id public.zone_type NOT NULL,
  detected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  detection_confidence NUMERIC(5,4) NOT NULL DEFAULT 0.0000,
  reviewed_status TEXT NOT NULL DEFAULT 'PENDING' CHECK (reviewed_status IN ('PENDING', 'REVIEWED', 'DISMISSED')),
  frame_hash TEXT NOT NULL DEFAULT '',
  reviewed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS unknown_detections_time ON public.unknown_detections (detected_at DESC);
GRANT SELECT, INSERT, UPDATE ON public.unknown_detections TO authenticated;
GRANT ALL ON public.unknown_detections TO service_role;
ALTER TABLE public.unknown_detections ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "Security and Admin manage unknown detections" ON public.unknown_detections
    FOR ALL TO authenticated
    USING (public.has_any_role(auth.uid(), ARRAY['security', 'super_admin']::public.app_role[]))
    WITH CHECK (public.has_any_role(auth.uid(), ARRAY['security', 'super_admin']::public.app_role[]));
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ── 6. Extend esp32_camera_nodes ────────────────────────────────────────────
ALTER TABLE public.esp32_camera_nodes
  ADD COLUMN IF NOT EXISTS boundary_coordinates JSONB DEFAULT '{"x1":0,"y1":150,"x2":400,"y2":150}'::jsonb,
  ADD COLUMN IF NOT EXISTS firmware_version TEXT DEFAULT 'v1.0.0';

-- ── 7. Realtime publications ────────────────────────────────────────────────
ALTER PUBLICATION supabase_realtime ADD TABLE public.attendance_records;
ALTER PUBLICATION supabase_realtime ADD TABLE public.unknown_detections;
ALTER PUBLICATION supabase_realtime ADD TABLE public.admin_audit_logs;
ALTER PUBLICATION supabase_realtime ADD TABLE public.departments;

-- ── 8. Enhanced Attendance Engine Trigger Function ──────────────────────────
CREATE OR REPLACE FUNCTION public.apply_transit()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _day DATE := (NEW."timestamp" AT TIME ZONE 'Asia/Kolkata')::date;
  _first_in TIMESTAMPTZ := NULL;
  _last_out TIMESTAMPTZ := NULL;
  _cur_state TEXT := 'OUT';
  _state_start TIMESTAMPTZ := NULL;
  _work_min INT := 0;
  _break_min INT := 0;
  _dur INT := 0;
  _t RECORD;
  _rec_id UUID;
  _continuous_work INT := 0;
  _cur_zone public.zone_type;
BEGIN
  -- 1. Debounce duplicate transits (ignore duplicate within 3 seconds for same user, direction and zone)
  IF EXISTS (
    SELECT 1 FROM public.passive_transits
    WHERE user_id = NEW.user_id
      AND id <> NEW.id
      AND direction = NEW.direction
      AND zone_to = NEW.zone_to
      AND abs(extract(epoch FROM (NEW."timestamp" - "timestamp"))) < 3
  ) THEN
    -- Suppress duplicate side-effects
    RETURN NEW;
  END IF;

  -- 2. Chronological evaluation over all transits for this employee on this IST date
  --    Guarantees out-of-order and repeated event immunity.
  FOR _t IN (
    SELECT "timestamp", direction, zone_from, zone_to
    FROM public.passive_transits
    WHERE user_id = NEW.user_id
      AND (("timestamp" AT TIME ZONE 'Asia/Kolkata')::date) = _day
    ORDER BY "timestamp" ASC
  ) LOOP
    -- Determine First IN
    IF _first_in IS NULL AND _t.direction = 'ZONE_ENTER' AND _t.zone_to = 'WORKSPACE_FLOOR' THEN
      _first_in := _t."timestamp";
    END IF;

    -- Determine Last OUT
    IF _t.direction = 'ZONE_EXIT' OR _t.zone_to = 'CORRIDOR_TRANSIT' THEN
      _last_out := _t."timestamp";
    END IF;

    -- Compute chronological interval
    IF _state_start IS NOT NULL AND _t."timestamp" > _state_start THEN
      _dur := greatest(0, floor(extract(epoch FROM (_t."timestamp" - _state_start)) / 60)::int);
      IF _cur_state = 'WORKSPACE' THEN
        _work_min := _work_min + _dur;
        _continuous_work := _continuous_work + _dur;
      ELSIF _cur_state = 'BREAK' THEN
        _break_min := _break_min + _dur;
        _continuous_work := 0;
      ELSE
        _continuous_work := 0;
      END IF;
    END IF;

    -- Transition state
    IF _t.zone_to = 'WORKSPACE_FLOOR' THEN
      _cur_state := 'WORKSPACE';
      _state_start := _t."timestamp";
    ELSIF _t.zone_to IN ('CAFETERIA_LOUNGE', 'OUTDOOR_TERRACE') THEN
      _cur_state := 'BREAK';
      _state_start := _t."timestamp";
    ELSE
      _cur_state := 'OUT';
      _state_start := _t."timestamp";
    END IF;
  END LOOP;

  -- 3. Upsert canonical attendance record
  INSERT INTO public.attendance_records (
    employee_id,
    attendance_date,
    first_in,
    last_out,
    total_work_minutes,
    total_break_minutes,
    status,
    missed_exit,
    updated_at
  ) VALUES (
    NEW.user_id,
    _day,
    _first_in,
    _last_out,
    _work_min,
    _break_min,
    CASE 
      WHEN _work_min >= 240 THEN 'PRESENT'::public.attendance_status
      WHEN _work_min > 0 THEN 'HALF_DAY'::public.attendance_status
      ELSE 'PRESENT'::public.attendance_status
    END,
    false,
    now()
  )
  ON CONFLICT (employee_id, attendance_date) DO UPDATE SET
    first_in = COALESCE(public.attendance_records.first_in, EXCLUDED.first_in),
    last_out = EXCLUDED.last_out,
    total_work_minutes = EXCLUDED.total_work_minutes,
    total_break_minutes = EXCLUDED.total_break_minutes,
    status = EXCLUDED.status,
    updated_at = now();

  -- 4. Maintain legacy employee_daily_dwell for backwards compatibility with OSH compliance cards
  INSERT INTO public.employee_daily_dwell (
    user_id,
    record_date,
    workspace_minutes,
    break_minutes,
    continuous_workspace_minutes,
    last_transition_time,
    osh_compliance_flag
  ) VALUES (
    NEW.user_id,
    _day,
    _work_min,
    _break_min,
    _continuous_work,
    NEW."timestamp",
    _continuous_work <= 270
  )
  ON CONFLICT (user_id, record_date) DO UPDATE SET
    workspace_minutes = EXCLUDED.workspace_minutes,
    break_minutes = EXCLUDED.break_minutes,
    continuous_workspace_minutes = EXCLUDED.continuous_workspace_minutes,
    last_transition_time = EXCLUDED.last_transition_time,
    osh_compliance_flag = public.employee_daily_dwell.osh_compliance_flag AND (EXCLUDED.continuous_workspace_minutes <= 270);

  -- 5. Update live presence zone on enterprise_users
  UPDATE public.enterprise_users
    SET current_zone = NEW.zone_to,
        is_in_workspace = (NEW.zone_to = 'WORKSPACE_FLOOR')
    WHERE id = NEW.user_id;

  RETURN NEW;
END;
$$;

