import type { HealthConfig } from "./config.js";

export interface HealthTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute: (args: Record<string, unknown>) => Promise<string>;
}

/**
 * Query Supabase PostgREST for the health schema.
 * Uses plain fetch — no npm dependencies needed.
 */
async function queryHealth(
  cfg: HealthConfig,
  table: string,
  queryParams: string,
): Promise<unknown> {
  const url = `${cfg.supabaseUrl}/rest/v1/${table}?${queryParams}`;
  const res = await fetch(url, {
    headers: {
      apikey: cfg.supabaseKey,
      Authorization: `Bearer ${cfg.supabaseKey}`,
      "Accept-Profile": "health",
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`PostgREST error ${res.status}: ${text}`);
  }

  return res.json();
}

export function createHealthTools(cfg: HealthConfig): HealthTool[] {
  return [
    {
      name: "query_health_metrics",
      description:
        "Query Apple Health metrics (steps, heart rate, weight, sleep, etc.) from the database. " +
        "Returns recent data points for a given metric name. " +
        "Common metric names: step_count, heart_rate, body_mass, active_energy, " +
        "basal_energy_burned, dietary_energy, sleep_analysis, blood_oxygen, " +
        "respiratory_rate, heart_rate_variability, resting_heart_rate, walking_heart_rate_average.",
      parameters: {
        type: "object",
        properties: {
          metric_name: {
            type: "string",
            description:
              'The metric name to query (e.g. "step_count", "heart_rate", "body_mass"). ' +
              "Leave empty to list all available metric names.",
          },
          days: {
            type: "number",
            description: "Number of days to look back (default: 7, max: 90)",
          },
          limit: {
            type: "number",
            description: "Max rows to return (default: 50, max: 500)",
          },
        },
        required: [],
      },
      async execute(args) {
        const metricName = args.metric_name as string | undefined;
        const days = Math.min((args.days as number) || 7, 90);
        const limit = Math.min((args.limit as number) || 50, 500);

        try {
          if (!metricName) {
            // List distinct metric names
            const data = (await queryHealth(
              cfg,
              "metrics",
              `select=name&user_id=eq.${cfg.userId}&order=name&limit=100`,
            )) as Array<{ name: string }>;
            const names = [...new Set(data.map((r) => r.name))];
            return `Available metrics (${names.length}):\n${names.join("\n")}`;
          }

          const since = new Date(
            Date.now() - days * 24 * 60 * 60 * 1000,
          ).toISOString();
          const data = (await queryHealth(
            cfg,
            "metrics",
            `user_id=eq.${cfg.userId}&name=eq.${encodeURIComponent(metricName)}&recorded_at=gte.${since}&order=recorded_at.desc&limit=${limit}&select=value,unit,extras,recorded_at`,
          )) as Array<{
            value: number;
            unit: string;
            extras: Record<string, unknown> | null;
            recorded_at: string;
          }>;

          if (data.length === 0) {
            return `No ${metricName} data found in the last ${days} days.`;
          }

          const lines = data.map((r) => {
            const date = new Date(r.recorded_at).toLocaleString("en-US", {
              timeZone: "Asia/Makassar",
              month: "short",
              day: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            });
            let line = `${date}: ${r.value} ${r.unit}`;
            if (r.extras) {
              const parts: string[] = [];
              if (r.extras.min != null) parts.push(`min=${r.extras.min}`);
              if (r.extras.avg != null) parts.push(`avg=${r.extras.avg}`);
              if (r.extras.max != null) parts.push(`max=${r.extras.max}`);
              if (parts.length > 0) line += ` (${parts.join(", ")})`;
            }
            return line;
          });

          return `${metricName} — last ${days} days (${data.length} data points):\n${lines.join("\n")}`;
        } catch (e) {
          return `Error querying metrics: ${e instanceof Error ? e.message : String(e)}`;
        }
      },
    },
    {
      name: "query_health_workouts",
      description:
        "Query workout sessions (running, cycling, swimming, strength training, etc.) from the database. " +
        "Returns workout name, duration, calories burned, and distance.",
      parameters: {
        type: "object",
        properties: {
          workout_name: {
            type: "string",
            description:
              'Filter by workout type (e.g. "Running", "Cycling"). Leave empty for all workouts.',
          },
          days: {
            type: "number",
            description: "Number of days to look back (default: 30, max: 90)",
          },
          limit: {
            type: "number",
            description: "Max rows to return (default: 20, max: 100)",
          },
        },
        required: [],
      },
      async execute(args) {
        const workoutName = args.workout_name as string | undefined;
        const days = Math.min((args.days as number) || 30, 90);
        const limit = Math.min((args.limit as number) || 20, 100);

        try {
          const since = new Date(
            Date.now() - days * 24 * 60 * 60 * 1000,
          ).toISOString();
          let params = `user_id=eq.${cfg.userId}&started_at=gte.${since}&order=started_at.desc&limit=${limit}&select=name,started_at,ended_at,duration_seconds,active_energy_kcal,distance_km,extras`;
          if (workoutName) {
            params += `&name=eq.${encodeURIComponent(workoutName)}`;
          }

          const data = (await queryHealth(cfg, "workouts", params)) as Array<{
            name: string;
            started_at: string;
            ended_at: string;
            duration_seconds: number | null;
            active_energy_kcal: number | null;
            distance_km: number | null;
            extras: Record<string, unknown> | null;
          }>;

          if (data.length === 0) {
            return `No workouts found in the last ${days} days.`;
          }

          const lines = data.map((w) => {
            const date = new Date(w.started_at).toLocaleString("en-US", {
              timeZone: "Asia/Makassar",
              month: "short",
              day: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            });
            const duration = w.duration_seconds
              ? `${Math.round(w.duration_seconds / 60)}min`
              : "";
            const cal = w.active_energy_kcal
              ? `${Math.round(w.active_energy_kcal)}kcal`
              : "";
            const dist = w.distance_km
              ? `${w.distance_km.toFixed(1)}km`
              : "";
            const parts = [duration, cal, dist].filter(Boolean).join(", ");
            return `${date}: ${w.name} — ${parts}`;
          });

          return `Workouts — last ${days} days (${data.length} sessions):\n${lines.join("\n")}`;
        } catch (e) {
          return `Error querying workouts: ${e instanceof Error ? e.message : String(e)}`;
        }
      },
    },
    {
      name: "query_health_summary",
      description:
        "Get a daily summary of key health metrics for the past N days. " +
        "Shows steps, active calories, resting heart rate, and weight in one view.",
      parameters: {
        type: "object",
        properties: {
          days: {
            type: "number",
            description: "Number of days to summarize (default: 7, max: 30)",
          },
        },
        required: [],
      },
      async execute(args) {
        const days = Math.min((args.days as number) || 7, 30);
        const since = new Date(
          Date.now() - days * 24 * 60 * 60 * 1000,
        ).toISOString();

        try {
          // Fetch key metrics in parallel
          const summaryMetrics = [
            "step_count",
            "active_energy",
            "resting_heart_rate",
            "body_mass",
          ];

          const results = await Promise.all(
            summaryMetrics.map((name) =>
              queryHealth(
                cfg,
                "metrics",
                `user_id=eq.${cfg.userId}&name=eq.${name}&recorded_at=gte.${since}&order=recorded_at.desc&limit=100&select=value,unit,recorded_at`,
              ).catch(() => []),
            ),
          );

          const sections: string[] = [];

          for (let i = 0; i < summaryMetrics.length; i++) {
            const name = summaryMetrics[i]!;
            const data = results[i] as Array<{
              value: number;
              unit: string;
              recorded_at: string;
            }>;
            if (!data || data.length === 0) continue;

            // Group by date and show daily aggregates
            const byDate = new Map<string, number[]>();
            for (const d of data) {
              const date = new Date(d.recorded_at).toLocaleDateString("en-US", {
                timeZone: "Asia/Makassar",
                month: "short",
                day: "numeric",
              });
              const arr = byDate.get(date) ?? [];
              arr.push(d.value);
              byDate.set(date, arr);
            }

            const dailyLines: string[] = [];
            for (const [date, values] of byDate) {
              const sum = values.reduce((a, b) => a + b, 0);
              const avg = sum / values.length;
              // For additive metrics (steps, calories), show sum; for others, show average
              const isAdditive =
                name === "step_count" || name === "active_energy";
              const display = isAdditive
                ? Math.round(sum)
                : Number(avg.toFixed(1));
              dailyLines.push(`  ${date}: ${display} ${data[0]!.unit}`);
            }

            sections.push(
              `${name.replace(/_/g, " ")}:\n${dailyLines.join("\n")}`,
            );
          }

          if (sections.length === 0) {
            return `No health data found for the last ${days} days.`;
          }

          return `Health Summary — last ${days} days:\n\n${sections.join("\n\n")}`;
        } catch (e) {
          return `Error generating summary: ${e instanceof Error ? e.message : String(e)}`;
        }
      },
    },
  ];
}
