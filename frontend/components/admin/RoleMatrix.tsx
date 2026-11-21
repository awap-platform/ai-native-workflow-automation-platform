/**
 * Role-by-permission matrix. It renders exactly the server's role definitions; the browser never
 * merges or infers a permission.
 */
export function RoleMatrix({
  roles,
  permissions,
}: {
  roles: Array<{ name: string; rank: number; permissions: string[] }>;
  permissions: Array<{ name: string }>;
}) {
  return (
    <div className="awap-table-wrap">
      <table className="awap-table" data-testid="role-permission-matrix">
        <caption className="sr-only">Role and permission matrix</caption>
        <thead>
          <tr>
            <th scope="col">Role</th>
            {permissions.map((permission) => (
              <th scope="col" key={permission.name}>
                {permission.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {roles.map((role) => (
            <tr key={role.name}>
              <th scope="row">
                {role.name} <span className="awap-muted">(rank {role.rank})</span>
              </th>
              {permissions.map((permission) => {
                const granted = role.permissions.includes(permission.name);
                return (
                  <td key={permission.name}>
                    <span
                      className={granted ? "awap-permission-yes" : "awap-permission-no"}
                      aria-label={granted ? "granted" : "not granted"}
                    >
                      {granted ? "✓" : "—"}
                    </span>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
