import AuthShell from "../../components/layout/AuthShell";
import RegisterWizard from "../../components/auth/RegisterWizard";

export default function RegisterPage() {
  return (
    <AuthShell>
      <RegisterWizard />
    </AuthShell>
  );
}
