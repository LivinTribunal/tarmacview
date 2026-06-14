import { Outlet } from "react-router";
import { useTranslation } from "react-i18next";
import NavBar from "./NavBar";
import type { NavItem } from "./NavBar";

/** super-admin layout - sticky nav shell with role-switch back to operator and coordinator. */
export default function SuperAdminLayout() {
  const { t } = useTranslation();

  const roleSwitchItems: NavItem[] = [
    { label: t("nav.missionCenter"), to: "/operator-center/dashboard" },
    { label: t("nav.configuratorCenter"), to: "/coordinator-center/airports" },
  ];
  const adminItems: NavItem[] = [
    { label: t("nav.users"), to: "/super-admin/users" },
    { label: t("nav.airports"), to: "/super-admin/airports" },
    { label: t("nav.system"), to: "/super-admin/system" },
    { label: t("nav.auditLog"), to: "/super-admin/audit-log" },
  ];

  return (
    <div className="h-screen overflow-y-auto bg-tv-bg text-tv-text-primary role-admin">
      <div className="sticky top-0 z-20 bg-tv-bg">
        <NavBar items={adminItems} roleSwitchItems={roleSwitchItems} role="admin" />
      </div>
      <main>
        <Outlet />
      </main>
    </div>
  );
}
