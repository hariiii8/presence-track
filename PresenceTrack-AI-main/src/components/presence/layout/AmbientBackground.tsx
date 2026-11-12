/** French Porcelain backdrop with slowly drifting blurred orbs. */
export function AmbientBackground() {
  return (
    <div className="pointer-events-none fixed inset-0 overflow-hidden" aria-hidden="true">
      <div
        className="ambient-orb -top-40 left-1/2 h-[28rem] w-[28rem] -translate-x-1/2 bg-penna/30 blur-[120px]"
        style={{ animationDuration: "42s" }}
      />
      <div
        className="ambient-orb top-1/3 right-0 h-[26rem] w-[26rem] bg-hudson/40 blur-[110px]"
        style={{ animationDuration: "48s" }}
      />
      <div
        className="ambient-orb bottom-0 left-0 h-[28rem] w-[28rem] bg-sage/20 blur-[130px]"
        style={{ animationDuration: "40s" }}
      />
      <div
        className="ambient-orb top-10 left-0 h-[20rem] w-[20rem] bg-success/10 blur-[100px]"
        style={{ animationDuration: "55s" }}
      />
      <div
        className="ambient-orb bottom-20 right-10 h-[20rem] w-[20rem] bg-warning/10 blur-[100px]"
        style={{ animationDuration: "45s" }}
      />
    </div>
  );
}
