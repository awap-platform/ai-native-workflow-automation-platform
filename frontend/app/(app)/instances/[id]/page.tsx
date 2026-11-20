"use client";

import { useParams } from "next/navigation";
import InstanceDetail from "../../../../components/instances/InstanceDetail";

/** Deep-linkable instance detail; tenant checks stay on the API and surface as 403/404. */
export default function InstanceDetailPage() {
  const params = useParams<{ id: string }>();
  return <InstanceDetail id={params.id} />;
}
