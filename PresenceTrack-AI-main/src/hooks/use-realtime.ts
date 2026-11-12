import { useEffect } from "react";
import { useQueryClient, type QueryKey } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

type Table = "passive_transits" | "esp32_camera_nodes" | "merkle_audit_blocks";

/**
 * Subscribe to live row changes and refresh the given queries. Access rules still apply:
 * subscribers only receive rows they are allowed to read.
 */
export function useRealtimeRefresh(
  table: Table,
  queryKeys: QueryKey[],
  opts: { filter?: string; onInsert?: () => void } = {},
) {
  const queryClient = useQueryClient();
  const keySig = JSON.stringify(queryKeys);
  const { filter, onInsert } = opts;

  useEffect(() => {
    const channel = supabase
      .channel(`${table}-${Math.random().toString(36).slice(2)}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table, ...(filter ? { filter } : {}) },
        (payload) => {
          for (const key of JSON.parse(keySig) as QueryKey[]) {
            void queryClient.invalidateQueries({ queryKey: key });
          }
          if (payload.eventType === "INSERT") onInsert?.();
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table, filter, keySig, queryClient]);
}
