// Supabase DB 型定義（supabase/schema.sql と対応）
// `npx supabase gen types typescript --project-id <id> > src/types/database.ts` で
// 自動生成した型に置き換えても構いません。

export type Database = {
  public: {
    Tables: {
      events: {
        Row: {
          id: string;
          title: string;
          max_photos_per_guest: number;
          reveal_at: string | null;
          owner_uid: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          title: string;
          max_photos_per_guest?: number;
          reveal_at?: string | null;
          owner_uid?: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          title?: string;
          max_photos_per_guest?: number;
          reveal_at?: string | null;
          owner_uid?: string;
          created_at?: string;
        };
        Relationships: [];
      };
      guests: {
        Row: {
          id: string;
          event_id: string;
          auth_uid: string;
          nickname: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          event_id: string;
          auth_uid?: string;
          nickname: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          event_id?: string;
          auth_uid?: string;
          nickname?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "guests_event_id_fkey";
            columns: ["event_id"];
            isOneToOne: false;
            referencedRelation: "events";
            referencedColumns: ["id"];
          },
        ];
      };
      photos: {
        Row: {
          id: string;
          event_id: string;
          guest_id: string;
          storage_path: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          event_id: string;
          guest_id: string;
          storage_path: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          event_id?: string;
          guest_id?: string;
          storage_path?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "photos_event_id_fkey";
            columns: ["event_id"];
            isOneToOne: false;
            referencedRelation: "events";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "photos_guest_id_fkey";
            columns: ["guest_id"];
            isOneToOne: false;
            referencedRelation: "guests";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: { [_ in never]: never };
    Functions: {
      get_event_public: {
        Args: { p_event_id: string };
        Returns: {
          id: string;
          title: string;
          max_photos_per_guest: number;
          reveal_at: string | null;
        }[];
      };
      get_event_stats: {
        Args: { p_event_id: string };
        Returns: { guest_count: number; photo_count: number }[];
      };
      is_event_owner: { Args: { p_event_id: string }; Returns: boolean };
      is_event_guest: { Args: { p_event_id: string }; Returns: boolean };
      is_event_revealed: { Args: { p_event_id: string }; Returns: boolean };
      owns_guest: { Args: { p_guest_id: string }; Returns: boolean };
    };
    Enums: { [_ in never]: never };
    CompositeTypes: { [_ in never]: never };
  };
};

type PublicTables = Database["public"]["Tables"];

export type EventRow = PublicTables["events"]["Row"];
export type GuestRow = PublicTables["guests"]["Row"];
export type PhotoRow = PublicTables["photos"]["Row"];

/** 参加前のゲストにも見せてよいイベント情報（get_event_public の戻り値） */
export type PublicEvent = Database["public"]["Functions"]["get_event_public"]["Returns"][number];

export type EventStats = Database["public"]["Functions"]["get_event_stats"]["Returns"][number];

/** ギャラリー表示用：署名付きURLとニックネームを付与した写真 */
export type GalleryPhoto = PhotoRow & {
  url: string;
  nickname: string;
};

export const PHOTO_BUCKET = "event-photos";
