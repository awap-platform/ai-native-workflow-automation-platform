import {
  BarChart3,
  Bell,
  Bot,
  Building2,
  FileText,
  FolderOpen,
  Inbox,
  Mail,
  Palette,
  PenTool,
  PlayCircle,
  ShieldCheck,
  Workflow,
} from "lucide-react";
import type { NavIcon } from "../../lib/navigation";

const icons: Record<NavIcon, typeof Inbox> = {
  inbox: Inbox,
  workflow: Workflow,
  designer: PenTool,
  form: FileText,
  instances: PlayCircle,
  document: FolderOpen,
  analytics: BarChart3,
  bell: Bell,
  template: Mail,
  organization: Building2,
  copilot: Bot,
  shield: ShieldCheck,
  palette: Palette,
};

export default function NavIconView({ icon }: { icon: NavIcon }) {
  const Icon = icons[icon];
  return <Icon className="size-4 shrink-0" aria-hidden="true" />;
}
