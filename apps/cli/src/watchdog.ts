const API = "https://api.cloudflare.com/client/v4";
const HOUR_MS = 3_600_000;
export const WATCH_HOURS = 6;

export interface Sighting {
  hour: string;
  application: string;
  instance: string;
}

export interface AlwaysOn {
  application: string;
  instance: string;
}

export function watchedHours(now: Date, hours: number): string[] {
  const end = Math.floor(now.getTime() / HOUR_MS) * HOUR_MS;
  return Array.from({ length: hours }, (_, at) =>
    new Date(end - (hours - at) * HOUR_MS).toISOString().replace(".000Z", "Z"),
  );
}

export function alwaysOn(
  sightings: readonly Sighting[],
  hours: readonly string[],
): AlwaysOn[] {
  const seen = new Map<string, { entry: AlwaysOn; hours: Set<string> }>();
  for (const sighting of sightings) {
    if (!hours.includes(sighting.hour)) continue;
    const key = `${sighting.application}/${sighting.instance}`;
    const record = seen.get(key) ?? {
      entry: { application: sighting.application, instance: sighting.instance },
      hours: new Set<string>(),
    };
    record.hours.add(sighting.hour);
    seen.set(key, record);
  }
  return [...seen.values()]
    .filter((record) => record.hours.size === hours.length)
    .map((record) => record.entry);
}

export async function watchContainers(now: Date): Promise<{
  hours: string[];
  alwaysOn: (AlwaysOn & { name: string })[];
}> {
  const account = required("CLOUDFLARE_ACCOUNT_ID");
  const token = required("CLOUDFLARE_API_TOKEN");
  const hours = watchedHours(now, WATCH_HOURS);
  const [sightings, names] = await Promise.all([
    fetchSightings(account, token, hours),
    fetchApplicationNames(account, token),
  ]);
  return {
    hours,
    alwaysOn: alwaysOn(sightings, hours).map((entry) => ({
      ...entry,
      name: names.get(entry.application) ?? "deleted application",
    })),
  };
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function fetchSightings(
  account: string,
  token: string,
  hours: readonly string[],
): Promise<Sighting[]> {
  const first = hours[0];
  if (first === undefined) return [];
  const query = `query($account: String!, $from: Time!, $to: Time!) {
    viewer { accounts(filter: { accountTag: $account }) {
      containersMetricsAdaptiveGroups(
        limit: 10000
        filter: { datetime_geq: $from, datetime_lt: $to }
      ) {
        dimensions { datetimeHour applicationId durableObjectId }
        sum { allocatedMemory }
      }
    } }
  }`;
  const to = new Date(Date.parse(first) + hours.length * HOUR_MS)
    .toISOString()
    .replace(".000Z", "Z");
  const response = await fetch(`${API}/graphql`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ query, variables: { account, from: first, to } }),
  });
  const body: unknown = await response.json();
  if (!response.ok || !isRecord(body) || body.errors) {
    throw new Error(
      `container metrics query failed (${response.status}): ${JSON.stringify(body).slice(0, 300)}`,
    );
  }
  const groups = pick(body, [
    "data",
    "viewer",
    "accounts",
    0,
  ])?.containersMetricsAdaptiveGroups;
  if (!Array.isArray(groups)) {
    throw new Error("container metrics answered without groups");
  }
  return groups.flatMap((group): Sighting[] => {
    const dimensions = isRecord(group) ? group.dimensions : undefined;
    const memory = isRecord(group) ? pick(group, ["sum"])?.allocatedMemory : 0;
    if (!isRecord(dimensions) || typeof memory !== "number" || memory <= 0) {
      return [];
    }
    const { datetimeHour, applicationId, durableObjectId } = dimensions;
    if (
      typeof datetimeHour !== "string" ||
      typeof applicationId !== "string" ||
      typeof durableObjectId !== "string"
    ) {
      return [];
    }
    return [
      {
        hour: datetimeHour,
        application: applicationId,
        instance: durableObjectId,
      },
    ];
  });
}

async function fetchApplicationNames(
  account: string,
  token: string,
): Promise<Map<string, string>> {
  const response = await fetch(
    `${API}/accounts/${account}/containers/applications`,
    { headers: { authorization: `Bearer ${token}` } },
  );
  const body: unknown = await response.json();
  const result = isRecord(body) ? body.result : undefined;
  if (!response.ok || !Array.isArray(result)) {
    throw new Error(`container applications list failed (${response.status})`);
  }
  return new Map(
    result.flatMap((application): [string, string][] =>
      isRecord(application) &&
      typeof application.id === "string" &&
      typeof application.name === "string"
        ? [[application.id, application.name]]
        : [],
    ),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function pick(
  value: unknown,
  path: readonly (string | number)[],
): Record<string, unknown> | undefined {
  let current = value;
  for (const step of path) {
    if (!isRecord(current)) return undefined;
    current = (current as Record<string | number, unknown>)[step];
  }
  return isRecord(current) ? current : undefined;
}
