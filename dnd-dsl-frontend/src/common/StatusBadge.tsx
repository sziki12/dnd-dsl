/** A quest's or objective's Status as a small coloured pill; nothing when it has none yet. */
export default function StatusBadge({ status }: { status: string | undefined }) {
  if (!status) return null;
  return <span className={`status-badge status-${status.toLowerCase()}`}>{status}</span>;
}
