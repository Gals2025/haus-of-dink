import { requirePermission } from "@/server/auth/authorize";
import { listAudit } from "@/server/admin/service";

export default async function AuditPage() {
  await requirePermission("audit:read");
  const entries = await listAudit();
  return <div className="space-y-6"><div><h1 className="text-4xl">Access history</h1>
    <p className="mt-3 text-muted-foreground">The 50 most recent administrative changes. Times shown in UTC.</p></div>
    <div className="overflow-x-auto rounded-xl border bg-card"><table className="w-full text-left text-sm">
      <caption className="sr-only">Administrative audit history</caption>
      <thead className="bg-muted"><tr>{["When (UTC)", "Actor / target IDs", "Change", "Before", "After"].map((label) => <th scope="col" className="p-4" key={label}>{label}</th>)}</tr></thead>
      <tbody>{entries.map((entry) => <tr className="border-t" key={entry.id}>
        <td className="whitespace-nowrap p-4">{new Date(entry.createdAt).toISOString().replace("T", " ").slice(0, 19)}</td>
        <td className="max-w-64 break-all p-4"><p>Actor: {entry.actorId}</p><p>Target: {entry.targetId}</p></td>
        <td className="p-4">{entry.action}</td>
        <td className="p-4">{entry.beforeRole} / {entry.beforeActive ? "active" : "inactive"}</td>
        <td className="p-4">{entry.afterRole} / {entry.afterActive ? "active" : "inactive"}</td>
      </tr>)}</tbody></table>{!entries.length && <p className="p-8">No administrative changes recorded yet.</p>}</div>
  </div>;
}
