-- ============================================================================
-- PresenceTrack Ambient – Database Expansion Migration
-- Adds: departments, attendance_records, admin_audit_logs, 
--       unknown_detections, recognition_consents
-- Enhances: enterprise_users, esp32_camera_nodes, apply_transit trigger
-- ============================================================================

-- 1. Departments Table
CREATE TABLE IF NOT EXISTS public.departments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  code TEXT NOT NULL UNIQUE,
  description TEXT,
  manager_id UUID REFERENCES public.enterprise_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT ON public.departments TO authenticated;
GRANT ALL ON public.departments TO service_role;
ALTER TABLE public.departments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users view departments" ON public.departments
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins manage departments" ON public.departments
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'super_admin'))
  WITH CHECK (public.has_role(auth.uid(), 'super_admin'));

-- 2. Extend enterprise_users with active status and employment metadata
ALTER TABLE public.enterprise_users
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS department_id UUID REFERENCES public.departments(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS employment_type TEXT NOT NULL DEFAULT 'FULL_TIME',
  ADD COLUMN IF NOT EXISTS shift_start TIME NOT NULL DEFAULT '09:00:00',
  ADD COLUMN IF NOT EXISTS shift_end TIME NOT NULL DEFAULT '18:00:00';

-- 3. Attendance Status Enum & Canonical Attendance Records Table
DO $$ BEGIN
  CREATE TYPE public.attendance_status AS ENUM ('PRESENT', 'ABSENT', 'HALF_DAY', 'ON_LEAVE', 'HOLIDAY');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS public.attendance_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.enterprise_users(id) ON DELETE CASCADE,
  record_date DATE NOT NULL DEFAULT CURRENT_DATE,
  first_in TIMESTAMPTZ,
  last_out TIMESTAMPTZ,
  total_workspace_minutes INT NOT NULL DEFAULT 0,
  total_break_minutes INT NOT NULL DEFAULT 0,
  status public.attendance_status NOT NULL DEFAULT 'PRESENT',
  anomaly_flag BOOLEAN NOT NULL DEFAULT false,
  anomaly_reason TEXT,
  is_manual_entry BOOLEAN NOT NULL DEFAULT false,
  approved_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, record_date)
);

CREATE INDEX IF NOT EXISTS attendance_records_user_date ON public.attendance_records (user_id, record_date DESC);
CREATE INDEX IF NOT EXISTS attendance_records_date ON public.attendance_records (record_date DESC);

GRANT SELECT ON public.attendance_records TO authenticated;
GRANT ALL ON public.attendance_records TO service_role;
ALTER TABLE public.attendance_records ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own attendance; HR and Admin read all" ON public.attendance_records
  FOR SELECT TO authenticated
  USING (
    user_id = public.current_enterprise_user_id()
    OR public.has_any_role(auth.uid(), ARRAY['hr_ops', 'super_admin']::public.app_role[])
  );

CREATE POLICY "HR and Admin update attendance" ON public.attendance_records
  FOR UPDATE TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['hr_ops', 'super_admin']::public.app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['hr_ops', 'super_admin']::public.app_role[]));

-- 4. Admin Audit Logs (Tamper-Evident Admin Action Trail)
CREATE TABLE IF NOT EXISTS public.admin_audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  target_entity TEXT NOT NULL,
  target_id TEXT,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  ip_address TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS admin_audit_logs_created_at ON public.admin_audit_logs (created_at DESC);
GRANT SELECT, INSERT ON public.admin_audit_logs TO authenticated;
GRANT ALL ON public.admin_audit_logs TO service_role;
ALTER TABLE public.admin_audit_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read audit logs" ON public.admin_audit_logs
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'super_admin'));

CREATE POLICY "Admins insert audit logs" ON public.admin_audit_logs
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = admin_id);

-- 5. Unknown Detections & Security Alerts Table
CREATE TABLE IF NOT EXISTS public.unknown_detections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  camera_id TEXT REFERENCES public.esp32_camera_nodes(id) ON DELETE SET NULL,
  zone public.zone_type NOT NULL,
  detected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  confidence NUMERIC(5,4) NOT NULL DEFAULT 0.0000,
  frame_hash TEXT NOT NULL,
  resolved BOOLEAN NOT NULL DEFAULT false,
  resolved_at TIMESTAMPTZ,
  resolved_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  notes TEXT
);

CREATE INDEX IF NOT EXISTS unknown_detections_time ON public.unknown_detections (detected_at DESC);
GRANT SELECT, UPDATE ON public.unknown_detections TO authenticated;
GRANT ALL ON public.unknown_detections TO service_role;
ALTER TABLE public.unknown_detections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Security and Admin manage unknown detections" ON public.unknown_detections
  FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['security', 'super_admin']::public.app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['security', 'super_admin']::public.app_role[]));

-- 6. Recognition Consents History Table
CREATE TABLE IF NOT EXISTS public.recognition_consents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.enterprise_users(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('ACTIVE', 'REVOKED')),
  event_type TEXT NOT NULL CHECK (event_type IN ('GRANTED', 'REVOKED', 'RESTORED')),
  document_version TEXT NOT NULL DEFAULT 'v1.0-DPDP-2023',
  ip_address TEXT,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS recognition_consents_user ON public.recognition_consents (user_id, timestamp DESC);
GRANT SELECT, INSERT ON public.recognition_consents TO authenticated;
GRANT ALL ON public.recognition_consents TO service_role;
ALTER TABLE public.recognition_consents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own consent history; Admins read all" ON public.recognition_consents
  FOR SELECT TO authenticated
  USING (
    user_id = public.current_enterprise_user_id()
    OR public.has_role(auth.uid(), 'super_admin')
  );

-- 7. Extend esp32_camera_nodes with boundary coordinates
ALTER TABLE public.esp32_camera_nodes
  ADD COLUMN IF NOT EXISTS boundary_coordinates JSONB DEFAULT '{"x1":0,"y1":150,"x2":400,"y2":150}'::jsonb,
  ADD COLUMN IF NOT EXISTS firmware_version TEXT DEFAULT 'v1.0.0';

-- 8. Enable Realtime Publications for new tables
ALTER PUBLICATION supabase_realtime ADD TABLE public.attendance_records;
ALTER PUBLICATION supabase_realtime ADD TABLE public.unknown_detections;
ALTER PUBLICATION supabase_realtime ADD TABLE public.admin_audit_logs;

-- 9. Seed default departments if table is empty
INSERT INTO public.departments (name, code, description)
VALUES 
  ('Engineering & R&D', 'ENG', 'Product development, systems, and hardware engineering'),
  ('Human Resources', 'HR', 'Workforce management, talent operations, and compliance'),
  ('Physical Security', 'SEC', 'Facility security, boundary surveillance, and access control'),
  ('Executive & Governance', 'EXEC', 'Corporate leadership and Data Protection Officer (DPO)')
ON CONFLICT (name) DO NOTHING;

