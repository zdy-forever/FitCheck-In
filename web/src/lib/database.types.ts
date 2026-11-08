
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "graphql_public": {
          Tables: {
            [_ in never]: never
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "graphql":
{ Args: { "extensions"?: Json,"operationName"?: string,"query"?: string,"variables"?: Json }; Returns: Json
                           }
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        },"public": {
          Tables: {
            "health_samples": {
                  Row: {
                    "category": string | null,"device_id": string | null,"id": number,"measured_at": string,"metadata": NonNullable<Json>,"metric_type": string,"origin": Database["public"]['Enums']["data_origin"],"received_at": string,"sample_id": string,"source_bundle": string | null,"source_name": string | null,"start_at": string,"unit": string,"user_id": string,"value": number
                  }
                  ComputedFields: never
                  Insert: {
                    "category"?: string | null,"device_id"?: string | null,"id"?: never,"measured_at": string,"metadata"?: NonNullable<Json>,"metric_type": string,"origin"?: Database["public"]['Enums']["data_origin"],"received_at"?: string,"sample_id": string,"source_bundle"?: string | null,"source_name"?: string | null,"start_at": string,"unit": string,"user_id": string,"value": number
                  }
                  Update: {
                    "category"?: string | null,"device_id"?: string | null,"id"?: never,"measured_at"?: string,"metadata"?: NonNullable<Json>,"metric_type"?: string,"origin"?: Database["public"]['Enums']["data_origin"],"received_at"?: string,"sample_id"?: string,"source_bundle"?: string | null,"source_name"?: string | null,"start_at"?: string,"unit"?: string,"user_id"?: string,"value"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "health_samples_device_id_fkey"
      columns: ["device_id"]
isOneToOne: false
      referencedRelation: "health_sync_devices"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "health_samples_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"health_sharing_permissions": {
                  Row: {
                    "category": Database["public"]['Enums']["health_category"],"client_id": string,"created_at": string,"granted": boolean,"id": string,"relationship_id": string,"trainer_id": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "category": Database["public"]['Enums']["health_category"],"client_id": string,"created_at"?: string,"granted"?: boolean,"id"?: string,"relationship_id": string,"trainer_id": string,"updated_at"?: string
                  }
                  Update: {
                    "category"?: Database["public"]['Enums']["health_category"],"client_id"?: string,"created_at"?: string,"granted"?: boolean,"id"?: string,"relationship_id"?: string,"trainer_id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "health_sharing_permissions_client_id_fkey"
      columns: ["client_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "health_sharing_permissions_relationship_id_fkey"
      columns: ["relationship_id"]
isOneToOne: false
      referencedRelation: "trainer_client_relationships"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "health_sharing_permissions_trainer_id_fkey"
      columns: ["trainer_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"health_snapshots": {
                  Row: {
                    "algorithm_version": string,"assessment": NonNullable<Json>,"completeness": number,"computed_at": string,"id": string,"origin": Database["public"]['Enums']["data_origin"],"snapshot_date": string,"time_zone": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "algorithm_version": string,"assessment": NonNullable<Json>,"completeness": number,"computed_at"?: string,"id"?: string,"origin"?: Database["public"]['Enums']["data_origin"],"snapshot_date": string,"time_zone": string,"user_id": string
                  }
                  Update: {
                    "algorithm_version"?: string,"assessment"?: NonNullable<Json>,"completeness"?: number,"computed_at"?: string,"id"?: string,"origin"?: Database["public"]['Enums']["data_origin"],"snapshot_date"?: string,"time_zone"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "health_snapshots_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"health_sync_devices": {
                  Row: {
                    "app_version": string | null,"created_at": string,"device_name": string,"enabled_categories": (Database["public"]['Enums']["health_category"])[],"id": string,"installation_id": string,"last_sample_count": number | null,"last_sync_at": string | null,"last_sync_error": string | null,"last_sync_status": string | null,"os_version": string | null,"platform": string,"revoked_at": string | null,"updated_at": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "app_version"?: string | null,"created_at"?: string,"device_name"?: string,"enabled_categories"?: (Database["public"]['Enums']["health_category"])[],"id"?: string,"installation_id": string,"last_sample_count"?: number | null,"last_sync_at"?: string | null,"last_sync_error"?: string | null,"last_sync_status"?: string | null,"os_version"?: string | null,"platform"?: string,"revoked_at"?: string | null,"updated_at"?: string,"user_id": string
                  }
                  Update: {
                    "app_version"?: string | null,"created_at"?: string,"device_name"?: string,"enabled_categories"?: (Database["public"]['Enums']["health_category"])[],"id"?: string,"installation_id"?: string,"last_sample_count"?: number | null,"last_sync_at"?: string | null,"last_sync_error"?: string | null,"last_sync_status"?: string | null,"os_version"?: string | null,"platform"?: string,"revoked_at"?: string | null,"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "health_sync_devices_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"post_session_feedback": {
                  Row: {
                    "client_id": string,"comments": string | null,"created_at": string,"enjoyment": number,"id": string,"pain_areas": (string)[],"pain_level": number,"session_id": string,"session_rpe": number,"trainer_id": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "client_id": string,"comments"?: string | null,"created_at"?: string,"enjoyment": number,"id"?: string,"pain_areas"?: (string)[],"pain_level": number,"session_id": string,"session_rpe": number,"trainer_id": string,"updated_at"?: string
                  }
                  Update: {
                    "client_id"?: string,"comments"?: string | null,"created_at"?: string,"enjoyment"?: number,"id"?: string,"pain_areas"?: (string)[],"pain_level"?: number,"session_id"?: string,"session_rpe"?: number,"trainer_id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "post_session_feedback_client_id_fkey"
      columns: ["client_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "post_session_feedback_session_id_fkey"
      columns: ["session_id"]
isOneToOne: true
      referencedRelation: "training_sessions"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "post_session_feedback_trainer_id_fkey"
      columns: ["trainer_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"pre_session_checkins": {
                  Row: {
                    "client_id": string,"created_at": string,"energy_level": number,"id": string,"mental_state": number,"muscle_soreness": number,"notes": string | null,"pain_areas": (string)[],"pain_level": number,"reviewed_at": string | null,"session_id": string | null,"sleep_quality": number,"trainer_id": string,"training_goal": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "client_id": string,"created_at"?: string,"energy_level": number,"id"?: string,"mental_state": number,"muscle_soreness": number,"notes"?: string | null,"pain_areas"?: (string)[],"pain_level": number,"reviewed_at"?: string | null,"session_id"?: string | null,"sleep_quality": number,"trainer_id": string,"training_goal": string,"updated_at"?: string
                  }
                  Update: {
                    "client_id"?: string,"created_at"?: string,"energy_level"?: number,"id"?: string,"mental_state"?: number,"muscle_soreness"?: number,"notes"?: string | null,"pain_areas"?: (string)[],"pain_level"?: number,"reviewed_at"?: string | null,"session_id"?: string | null,"sleep_quality"?: number,"trainer_id"?: string,"training_goal"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "pre_session_checkins_client_id_fkey"
      columns: ["client_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "pre_session_checkins_session_id_fkey"
      columns: ["session_id"]
isOneToOne: false
      referencedRelation: "training_sessions"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "pre_session_checkins_trainer_id_fkey"
      columns: ["trainer_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"profiles": {
                  Row: {
                    "bio": string | null,"created_at": string,"display_name": string,"id": string,"is_demo": boolean,"locale": string,"role": Database["public"]['Enums']["user_role"],"time_zone": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "bio"?: string | null,"created_at"?: string,"display_name": string,"id": string,"is_demo"?: boolean,"locale"?: string,"role": Database["public"]['Enums']["user_role"],"time_zone"?: string,"updated_at"?: string
                  }
                  Update: {
                    "bio"?: string | null,"created_at"?: string,"display_name"?: string,"id"?: string,"is_demo"?: boolean,"locale"?: string,"role"?: Database["public"]['Enums']["user_role"],"time_zone"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"session_exercises": {
                  Row: {
                    "created_at": string,"id": string,"name": string,"notes": string | null,"position": number,"reps": number | null,"session_id": string,"sets": number | null,"weight_kg": number | null
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"id"?: string,"name": string,"notes"?: string | null,"position"?: number,"reps"?: number | null,"session_id": string,"sets"?: number | null,"weight_kg"?: number | null
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"name"?: string,"notes"?: string | null,"position"?: number,"reps"?: number | null,"session_id"?: string,"sets"?: number | null,"weight_kg"?: number | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "session_exercises_session_id_fkey"
      columns: ["session_id"]
isOneToOne: false
      referencedRelation: "training_sessions"
      referencedColumns: ["id"]
    }
                  ]
                },"trainer_client_relationships": {
                  Row: {
                    "client_id": string,"created_at": string,"ended_at": string | null,"ended_by": string | null,"id": string,"invitation_id": string | null,"started_at": string,"status": Database["public"]['Enums']["relationship_status"],"trainer_id": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "client_id": string,"created_at"?: string,"ended_at"?: string | null,"ended_by"?: string | null,"id"?: string,"invitation_id"?: string | null,"started_at"?: string,"status"?: Database["public"]['Enums']["relationship_status"],"trainer_id": string,"updated_at"?: string
                  }
                  Update: {
                    "client_id"?: string,"created_at"?: string,"ended_at"?: string | null,"ended_by"?: string | null,"id"?: string,"invitation_id"?: string | null,"started_at"?: string,"status"?: Database["public"]['Enums']["relationship_status"],"trainer_id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "trainer_client_relationships_client_id_fkey"
      columns: ["client_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "trainer_client_relationships_ended_by_fkey"
      columns: ["ended_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "trainer_client_relationships_invitation_id_fkey"
      columns: ["invitation_id"]
isOneToOne: false
      referencedRelation: "trainer_invitations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "trainer_client_relationships_trainer_id_fkey"
      columns: ["trainer_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"trainer_invitations": {
                  Row: {
                    "accepted_at": string | null,"accepted_by": string | null,"code": string,"created_at": string,"expires_at": string,"id": string,"invitee_email": string | null,"note": string | null,"status": Database["public"]['Enums']["invitation_status"],"trainer_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "accepted_at"?: string | null,"accepted_by"?: string | null,"code"?: string,"created_at"?: string,"expires_at"?: string,"id"?: string,"invitee_email"?: string | null,"note"?: string | null,"status"?: Database["public"]['Enums']["invitation_status"],"trainer_id": string
                  }
                  Update: {
                    "accepted_at"?: string | null,"accepted_by"?: string | null,"code"?: string,"created_at"?: string,"expires_at"?: string,"id"?: string,"invitee_email"?: string | null,"note"?: string | null,"status"?: Database["public"]['Enums']["invitation_status"],"trainer_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "trainer_invitations_accepted_by_fkey"
      columns: ["accepted_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "trainer_invitations_trainer_id_fkey"
      columns: ["trainer_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"trainer_notes": {
                  Row: {
                    "body": string,"client_id": string,"created_at": string,"id": string,"performance_rating": number | null,"recommendations": string | null,"session_id": string | null,"trainer_id": string,"updated_at": string,"visibility": Database["public"]['Enums']["note_visibility"]
                  }
                  ComputedFields: never
                  Insert: {
                    "body": string,"client_id": string,"created_at"?: string,"id"?: string,"performance_rating"?: number | null,"recommendations"?: string | null,"session_id"?: string | null,"trainer_id": string,"updated_at"?: string,"visibility"?: Database["public"]['Enums']["note_visibility"]
                  }
                  Update: {
                    "body"?: string,"client_id"?: string,"created_at"?: string,"id"?: string,"performance_rating"?: number | null,"recommendations"?: string | null,"session_id"?: string | null,"trainer_id"?: string,"updated_at"?: string,"visibility"?: Database["public"]['Enums']["note_visibility"]
                  }
                  Relationships: [
                    {
      foreignKeyName: "trainer_notes_client_id_fkey"
      columns: ["client_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "trainer_notes_session_id_fkey"
      columns: ["session_id"]
isOneToOne: false
      referencedRelation: "training_sessions"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "trainer_notes_trainer_id_fkey"
      columns: ["trainer_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"training_sessions": {
                  Row: {
                    "actual_intensity": number | null,"client_id": string,"created_at": string,"duration_minutes": number | null,"id": string,"location": string | null,"planned_intensity": number | null,"scheduled_at": string,"session_type": string,"status": Database["public"]['Enums']["session_status"],"title": string | null,"trainer_id": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "actual_intensity"?: number | null,"client_id": string,"created_at"?: string,"duration_minutes"?: number | null,"id"?: string,"location"?: string | null,"planned_intensity"?: number | null,"scheduled_at": string,"session_type"?: string,"status"?: Database["public"]['Enums']["session_status"],"title"?: string | null,"trainer_id": string,"updated_at"?: string
                  }
                  Update: {
                    "actual_intensity"?: number | null,"client_id"?: string,"created_at"?: string,"duration_minutes"?: number | null,"id"?: string,"location"?: string | null,"planned_intensity"?: number | null,"scheduled_at"?: string,"session_type"?: string,"status"?: Database["public"]['Enums']["session_status"],"title"?: string | null,"trainer_id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "training_sessions_client_id_fkey"
      columns: ["client_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "training_sessions_trainer_id_fkey"
      columns: ["trainer_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                }
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "accept_invitation":
{ Args: { "p_code": string,"p_share"?: (Database["public"]['Enums']["health_category"])[] }; Returns: string
                           },
"can_view_health":
{ Args: { "p_category": Database["public"]['Enums']["health_category"],"p_client": string }; Returns: boolean
                           },
"delete_my_account":
{ Args: Record<PropertyKey, never>; Returns: undefined
                           },
"delete_my_health_data":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"end_relationship":
{ Args: { "p_relationship_id": string }; Returns: undefined
                           },
"generate_invite_code":
{ Args: Record<PropertyKey, never>; Returns: string
                           },
"get_invitation_preview":
{ Args: { "p_code": string }; Returns: {
              "expires_at": string,"is_expired": boolean,"status": Database["public"]['Enums']["invitation_status"],"trainer_name": string
            }[]
                           },
"health_metric_category":
{ Args: { "p_metric": string }; Returns: Database["public"]['Enums']["health_category"]
                           },
"health_metric_unit":
{ Args: { "p_metric": string }; Returns: string
                           },
"is_active_trainer_of":
{ Args: { "p_client": string }; Returns: boolean
                           },
"mark_checkin_reviewed":
{ Args: { "p_checkin_id": string }; Returns: string
                           },
"my_role":
{ Args: Record<PropertyKey, never>; Returns: Database["public"]['Enums']["user_role"]
                           },
"purge_expired_demo_accounts":
{ Args: { "p_older_than"?: string }; Returns: number
                           },
"shares_relationship_with":
{ Args: { "p_other": string }; Returns: boolean
                           },
"trainer_client_overview":
{ Args: Record<PropertyKey, never>; Returns: {
              "client_id": string,"display_name": string,"health_last_sync_at": string,"health_shared": boolean,"last_session_at": string,"latest_checkin_at": string,"latest_checkin_energy": number,"latest_checkin_id": string,"latest_checkin_mental": number,"latest_checkin_pain": number,"latest_checkin_reviewed_at": string,"latest_checkin_sleep": number,"latest_checkin_soreness": number,"next_session_at": string,"relationship_id": string,"started_at": string,"time_zone": string,"unreviewed_checkins": number
            }[]
                           }
          }
          Enums: {
            "data_origin": "healthkit"|"demo","health_category": "scores"|"hrv"|"resting_heart_rate"|"heart_rate"|"sleep"|"activity"|"workouts"|"vo2_max","invitation_status": "pending"|"accepted"|"revoked","note_visibility": "private"|"shared","relationship_status": "active"|"ended","session_status": "planned"|"completed"|"cancelled","user_role": "trainer"|"client"
          }
          CompositeTypes: {
            [_ in never]: never
          }
        }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
      Row: infer R
    }
    ? R
    : never
  : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Insert: infer I
    }
    ? I
    : never
  : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Update: infer U
    }
    ? U
    : never
  : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
  ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
  : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "graphql_public": {
          Enums: {
            
          }
        },"public": {
          Enums: {
            "data_origin": ["healthkit", "demo"],"health_category": ["scores", "hrv", "resting_heart_rate", "heart_rate", "sleep", "activity", "workouts", "vo2_max"],"invitation_status": ["pending", "accepted", "revoked"],"note_visibility": ["private", "shared"],"relationship_status": ["active", "ended"],"session_status": ["planned", "completed", "cancelled"],"user_role": ["trainer", "client"]
          }
        }
} as const
