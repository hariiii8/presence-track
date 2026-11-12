export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.18";
  };
  public: {
    Tables: {
      admin_audit_logs: {
        Row: {
          action: string;
          actor_id: string;
          created_at: string;
          entity_id: string | null;
          entity_type: string;
          id: string;
          metadata: Json;
        };
        Insert: {
          action: string;
          actor_id: string;
          created_at?: string;
          entity_id?: string | null;
          entity_type: string;
          id?: string;
          metadata?: Json;
        };
        Update: {
          action?: string;
          actor_id?: string;
          created_at?: string;
          entity_id?: string | null;
          entity_type?: string;
          id?: string;
          metadata?: Json;
        };
        Relationships: [];
      };
      attendance_records: {
        Row: {
          anomaly_reason: string | null;
          approved_by: string | null;
          attendance_date: string;
          created_at: string;
          employee_id: string;
          first_in: string | null;
          id: string;
          is_manual_entry: boolean;
          last_out: string | null;
          missed_exit: boolean;
          status: Database["public"]["Enums"]["attendance_status"];
          total_break_minutes: number;
          total_work_minutes: number;
          updated_at: string;
        };
        Insert: {
          anomaly_reason?: string | null;
          approved_by?: string | null;
          attendance_date?: string;
          created_at?: string;
          employee_id: string;
          first_in?: string | null;
          id?: string;
          is_manual_entry?: boolean;
          last_out?: string | null;
          missed_exit?: boolean;
          status?: Database["public"]["Enums"]["attendance_status"];
          total_break_minutes?: number;
          total_work_minutes?: number;
          updated_at?: string;
        };
        Update: {
          anomaly_reason?: string | null;
          approved_by?: string | null;
          attendance_date?: string;
          created_at?: string;
          employee_id?: string;
          first_in?: string | null;
          id?: string;
          is_manual_entry?: boolean;
          last_out?: string | null;
          missed_exit?: boolean;
          status?: Database["public"]["Enums"]["attendance_status"];
          total_break_minutes?: number;
          total_work_minutes?: number;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "attendance_records_employee_id_fkey";
            columns: ["employee_id"];
            isOneToOne: false;
            referencedRelation: "enterprise_users";
            referencedColumns: ["id"];
          },
        ];
      };
      departments: {
        Row: {
          created_at: string;
          description: string | null;
          id: string;
          name: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          description?: string | null;
          id?: string;
          name: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          description?: string | null;
          id?: string;
          name?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      dpo_erasure_requests: {
        Row: {
          badge_id: string;
          completed_at: string | null;
          email: string;
          erasure_scope: Json;
          id: string;
          requestor_name: string;
          status: string;
          submitted_at: string;
          user_id: string | null;
          zeroization_proof_url: string | null;
        };
        Insert: {
          badge_id: string;
          completed_at?: string | null;
          email: string;
          erasure_scope: Json;
          id?: string;
          requestor_name: string;
          status?: string;
          submitted_at?: string;
          user_id?: string | null;
          zeroization_proof_url?: string | null;
        };
        Update: {
          badge_id?: string;
          completed_at?: string | null;
          email?: string;
          erasure_scope?: Json;
          id?: string;
          requestor_name?: string;
          status?: string;
          submitted_at?: string;
          user_id?: string | null;
          zeroization_proof_url?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "dpo_erasure_requests_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "enterprise_users";
            referencedColumns: ["id"];
          },
        ];
      };
      employee_daily_dwell: {
        Row: {
          break_minutes: number;
          continuous_workspace_minutes: number;
          id: string;
          last_transition_time: string;
          osh_compliance_flag: boolean;
          record_date: string;
          user_id: string;
          workspace_minutes: number;
        };
        Insert: {
          break_minutes?: number;
          continuous_workspace_minutes?: number;
          id?: string;
          last_transition_time?: string;
          osh_compliance_flag?: boolean;
          record_date?: string;
          user_id: string;
          workspace_minutes?: number;
        };
        Update: {
          break_minutes?: number;
          continuous_workspace_minutes?: number;
          id?: string;
          last_transition_time?: string;
          osh_compliance_flag?: boolean;
          record_date?: string;
          user_id?: string;
          workspace_minutes?: number;
        };
        Relationships: [
          {
            foreignKeyName: "employee_daily_dwell_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "enterprise_users";
            referencedColumns: ["id"];
          },
        ];
      };
      enterprise_users: {
        Row: {
          auth_user_id: string | null;
          avatar_url: string | null;
          badge_id: string;
          consent_revoked: boolean;
          created_at: string;
          current_zone: Database["public"]["Enums"]["zone_type"] | null;
          department: string;
          department_id: string | null;
          email: string;
          employment_type: string;
          enrolled_embedding: Json | null;
          id: string;
          imported_role: Database["public"]["Enums"]["app_role"] | null;
          is_active: boolean;
          is_in_workspace: boolean | null;
          name: string;
          role_title: string;
          shift_end: string;
          shift_start: string;
        };
        Insert: {
          auth_user_id?: string | null;
          avatar_url?: string | null;
          badge_id: string;
          consent_revoked?: boolean;
          created_at?: string;
          current_zone?: Database["public"]["Enums"]["zone_type"] | null;
          department?: string;
          department_id?: string | null;
          email: string;
          employment_type?: string;
          enrolled_embedding?: Json | null;
          id?: string;
          imported_role?: Database["public"]["Enums"]["app_role"] | null;
          is_active?: boolean;
          is_in_workspace?: boolean | null;
          name: string;
          role_title?: string;
          shift_end?: string;
          shift_start?: string;
        };
        Update: {
          auth_user_id?: string | null;
          avatar_url?: string | null;
          badge_id?: string;
          consent_revoked?: boolean;
          created_at?: string;
          current_zone?: Database["public"]["Enums"]["zone_type"] | null;
          department?: string;
          department_id?: string | null;
          email?: string;
          employment_type?: string;
          enrolled_embedding?: Json | null;
          id?: string;
          imported_role?: Database["public"]["Enums"]["app_role"] | null;
          is_active?: boolean;
          is_in_workspace?: boolean | null;
          name?: string;
          role_title?: string;
          shift_end?: string;
          shift_start?: string;
        };
        Relationships: [
          {
            foreignKeyName: "enterprise_users_department_id_fkey";
            columns: ["department_id"];
            isOneToOne: false;
            referencedRelation: "departments";
            referencedColumns: ["id"];
          },
        ];
      };
      esp32_camera_nodes: {
        Row: {
          boundary_coordinates: Json | null;
          boundary_name: string;
          firmware_version: string | null;
          fps: number;
          id: string;
          is_online: boolean;
          last_ping: string | null;
          stream_url: string;
          zone_a: Database["public"]["Enums"]["zone_type"];
          zone_b: Database["public"]["Enums"]["zone_type"];
        };
        Insert: {
          boundary_coordinates?: Json | null;
          boundary_name: string;
          firmware_version?: string | null;
          fps?: number;
          id: string;
          is_online?: boolean;
          last_ping?: string | null;
          stream_url: string;
          zone_a: Database["public"]["Enums"]["zone_type"];
          zone_b: Database["public"]["Enums"]["zone_type"];
        };
        Update: {
          boundary_coordinates?: Json | null;
          boundary_name?: string;
          firmware_version?: string | null;
          fps?: number;
          id?: string;
          is_online?: boolean;
          last_ping?: string | null;
          stream_url?: string;
          zone_a?: Database["public"]["Enums"]["zone_type"];
          zone_b?: Database["public"]["Enums"]["zone_type"];
        };
        Relationships: [];
      };
      merkle_audit_blocks: {
        Row: {
          block_height: number;
          dilithium_signature: string;
          leaf_hashes: string[];
          previous_hash: string;
          root_hash: string;
          status: string;
          timestamp: string;
          transaction_count: number;
          validator_enclave: string;
        };
        Insert: {
          block_height: number;
          dilithium_signature: string;
          leaf_hashes?: string[];
          previous_hash: string;
          root_hash: string;
          status?: string;
          timestamp?: string;
          transaction_count: number;
          validator_enclave: string;
        };
        Update: {
          block_height?: number;
          dilithium_signature?: string;
          leaf_hashes?: string[];
          previous_hash?: string;
          root_hash?: string;
          status?: string;
          timestamp?: string;
          transaction_count?: number;
          validator_enclave?: string;
        };
        Relationships: [];
      };
      passive_transits: {
        Row: {
          camera_id: string | null;
          cosine_score: number;
          direction: Database["public"]["Enums"]["transit_direction"];
          dram_scrub_ms: number;
          id: string;
          timestamp: string;
          user_id: string;
          vector_hash: string;
          zone_from: Database["public"]["Enums"]["zone_type"];
          zone_to: Database["public"]["Enums"]["zone_type"];
        };
        Insert: {
          camera_id?: string | null;
          cosine_score: number;
          direction: Database["public"]["Enums"]["transit_direction"];
          dram_scrub_ms: number;
          id?: string;
          timestamp?: string;
          user_id: string;
          vector_hash: string;
          zone_from: Database["public"]["Enums"]["zone_type"];
          zone_to: Database["public"]["Enums"]["zone_type"];
        };
        Update: {
          camera_id?: string | null;
          cosine_score?: number;
          direction?: Database["public"]["Enums"]["transit_direction"];
          dram_scrub_ms?: number;
          id?: string;
          timestamp?: string;
          user_id?: string;
          vector_hash?: string;
          zone_from?: Database["public"]["Enums"]["zone_type"];
          zone_to?: Database["public"]["Enums"]["zone_type"];
        };
        Relationships: [
          {
            foreignKeyName: "passive_transits_camera_id_fkey";
            columns: ["camera_id"];
            isOneToOne: false;
            referencedRelation: "esp32_camera_nodes";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "passive_transits_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "enterprise_users";
            referencedColumns: ["id"];
          },
        ];
      };
      unknown_detections: {
        Row: {
          created_at: string;
          detection_confidence: number;
          device_id: string | null;
          frame_hash: string;
          id: string;
          notes: string | null;
          reviewed_at: string | null;
          reviewed_by: string | null;
          reviewed_status: "PENDING" | "REVIEWED" | "DISMISSED";
          zone_id: Database["public"]["Enums"]["zone_type"];
          detected_at: string;
        };
        Insert: {
          created_at?: string;
          detection_confidence?: number;
          device_id?: string | null;
          frame_hash?: string;
          id?: string;
          notes?: string | null;
          reviewed_at?: string | null;
          reviewed_by?: string | null;
          reviewed_status?: "PENDING" | "REVIEWED" | "DISMISSED";
          zone_id: Database["public"]["Enums"]["zone_type"];
          detected_at?: string;
        };
        Update: {
          created_at?: string;
          detection_confidence?: number;
          device_id?: string | null;
          frame_hash?: string;
          id?: string;
          notes?: string | null;
          reviewed_at?: string | null;
          reviewed_by?: string | null;
          reviewed_status?: "PENDING" | "REVIEWED" | "DISMISSED";
          zone_id?: Database["public"]["Enums"]["zone_type"];
          detected_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "unknown_detections_device_id_fkey";
            columns: ["device_id"];
            isOneToOne: false;
            referencedRelation: "esp32_camera_nodes";
            referencedColumns: ["id"];
          },
        ];
      };
      user_roles: {
        Row: {
          created_at: string;
          id: string;
          role: Database["public"]["Enums"]["app_role"];
          user_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          role: Database["public"]["Enums"]["app_role"];
          user_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          role?: Database["public"]["Enums"]["app_role"];
          user_id?: string;
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      approve_erasure_request: {
        Args: { _request_id: string };
        Returns: undefined;
      };
      current_enterprise_user_id: { Args: never; Returns: string };
      exercise_erasure: { Args: { _scope: string[] }; Returns: string };
      has_any_role: {
        Args: {
          _roles: Database["public"]["Enums"]["app_role"][];
          _user_id: string;
        };
        Returns: boolean;
      };
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"];
          _user_id: string;
        };
        Returns: boolean;
      };
      restore_consent: { Args: never; Returns: undefined };
    };
    Enums: {
      app_role: "employee" | "hr_ops" | "security" | "super_admin";
      attendance_status: "PRESENT" | "ABSENT" | "HALF_DAY" | "ON_LEAVE" | "HOLIDAY";
      transit_direction: "ZONE_ENTER" | "ZONE_EXIT";
      zone_type: "WORKSPACE_FLOOR" | "CAFETERIA_LOUNGE" | "OUTDOOR_TERRACE" | "CORRIDOR_TRANSIT";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema["CompositeTypes"] | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {
      app_role: ["employee", "hr_ops", "security", "super_admin"],
      attendance_status: ["PRESENT", "ABSENT", "HALF_DAY", "ON_LEAVE", "HOLIDAY"],
      transit_direction: ["ZONE_ENTER", "ZONE_EXIT"],
      zone_type: ["WORKSPACE_FLOOR", "CAFETERIA_LOUNGE", "OUTDOOR_TERRACE", "CORRIDOR_TRANSIT"],
    },
  },
} as const;
