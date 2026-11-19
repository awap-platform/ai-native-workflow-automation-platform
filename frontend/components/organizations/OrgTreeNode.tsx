"use client";

import { useState } from "react";
import type { CompanyTreeDto, DepartmentTreeDto, TeamTreeDto } from "../../lib/api";

function TeamNode({ team }: { team: TeamTreeDto }) {
  const [open, setOpen] = useState(false);
  return (
    <li>
      <button
        type="button"
        className="awap-link-button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {open ? "▾" : "▸"} {team.name}
      </button>
      {open ? (
        <ul className="awap-list pl-4">
          {team.users.map((user) => (
            <li key={user.id}>
              {user.fullName} — {user.email}
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}

function DepartmentNode({ department }: { department: DepartmentTreeDto }) {
  const [open, setOpen] = useState(false);
  return (
    <li>
      <button
        type="button"
        className="awap-link-button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {open ? "▾" : "▸"} {department.name}
      </button>
      {open ? (
        <ul className="awap-list pl-4">
          {department.teams.map((team) => (
            <TeamNode key={team.id} team={team} />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

function CompanyNode({ company }: { company: CompanyTreeDto }) {
  const [open, setOpen] = useState(false);
  return (
    <li>
      <button
        type="button"
        className="awap-link-button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {open ? "▾" : "▸"} {company.name}
      </button>
      {open ? (
        <ul className="awap-list pl-4">
          {company.departments.map((department) => (
            <DepartmentNode key={department.id} department={department} />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

export default function OrgTreeNode({ companies }: { companies: CompanyTreeDto[] }) {
  return (
    <ul className="awap-list" aria-label="Organization tree">
      {companies.map((company) => (
        <CompanyNode key={company.id} company={company} />
      ))}
    </ul>
  );
}
