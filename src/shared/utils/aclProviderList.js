// Shared ACL provider-list builder used by the Edit Access dialog.
// Pure function so it can be unit-tested without a React render.

/**
 * Build the provider list for the ACL dialog:
 * - providers that have at least one connection (count = connection count)
 * - registered noAuth/free providers even with zero connections (count 0),
 *   because they are grantable without credentials
 * - auth-requiring registered providers with zero connections are NOT
 *   ACL-eligible and stay hidden (can't be used without a connection)
 *
 * Display names resolve from provider nodes first, then the registry
 * displayName; aliases and custom node prefixes are preserved.
 */
export function buildProviderList(connections, nodes, registered = []) {
  const nodeMap = {};
  for (const n of (nodes || [])) {
    nodeMap[n.id] = { name: n.name, prefix: n.prefix || null, type: n.type };
  }

  const byProvider = {};
  for (const c of (connections || [])) {
    const p = c.provider;
    if (!byProvider[p]) byProvider[p] = { id: p, count: 0, alias: c.alias || null };
    byProvider[p].count++;
  }

  // Include registered noAuth providers with no connection (free, grantable).
  // Skip auth-requiring providers that have no connection — they are not
  // ACL-eligible and would just be noise in the dialog.
  for (const r of (registered || [])) {
    if (!r.noAuth) continue;
    if (!byProvider[r.id]) {
      byProvider[r.id] = { id: r.id, count: 0, alias: r.alias || null };
    }
  }

  const regById = {};
  for (const r of (registered || [])) regById[r.id] = r;

  return Object.values(byProvider).map(({ id, count, alias }) => {
    const node = nodeMap[id];
    const rp = regById[id];
    let displayName = rp?.displayName || id;
    let prefix = null;
    if (node) {
      displayName = node.name || id;
      prefix = node.prefix || null;
    }
    return { id, displayName, prefix, alias, count };
  }).sort((a, b) => a.displayName.localeCompare(b.displayName));
}
