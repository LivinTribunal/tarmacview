import { useEffect, useState } from "react";
import {
  getUser,
  updateUser,
  resetPassword,
  updateUserAirports,
  listAuditLogs,
} from "@/api/admin";
import type { UserAdminResponse, AuditLogEntry } from "@/types/admin";

interface UseSuperAdminUserDetailParams {
  selectedUserId: string | undefined;
  fetchUsers: () => void;
  navigate: (path: string) => void;
}

interface SuperAdminUserDetailReturn {
  selectedUser: UserAdminResponse | null;
  editName: string;
  editEmail: string;
  editRole: string;
  saving: boolean;
  resetLink: string;
  userLogs: AuditLogEntry[];
  setEditName: (value: string) => void;
  setEditEmail: (value: string) => void;
  setEditRole: (value: string) => void;
  handleSaveUser: () => Promise<void>;
  handleResetPassword: () => Promise<void>;
  handleRemoveAirport: (airportId: string) => Promise<void>;
  handleAddAirport: (airportId: string) => Promise<void>;
}

/** owns the super-admin user detail state, fetch effect, and edit/airport handlers. */
export default function useSuperAdminUserDetail({
  selectedUserId,
  fetchUsers,
  navigate,
}: UseSuperAdminUserDetailParams): SuperAdminUserDetailReturn {
  const [selectedUser, setSelectedUser] = useState<UserAdminResponse | null>(null);
  const [editName, setEditName] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editRole, setEditRole] = useState("");
  const [saving, setSaving] = useState(false);
  const [resetLink, setResetLink] = useState("");
  const [userLogs, setUserLogs] = useState<AuditLogEntry[]>([]);

  useEffect(() => {
    if (selectedUserId) {
      getUser(selectedUserId)
        .then((u) => {
          setSelectedUser(u);
          setEditName(u.name);
          setEditEmail(u.email);
          setEditRole(u.role);
        })
        .catch((err) => {
          console.warn("user fetch failed; redirecting", err);
          navigate("/super-admin/users");
        });
      listAuditLogs({ user_id: selectedUserId, limit: 20, sort_by: "timestamp", sort_dir: "desc" })
        .then((res) => setUserLogs(res.data))
        .catch((err) => {
          console.warn("user audit logs fetch failed", err);
          setUserLogs([]);
        });
    } else {
      setSelectedUser(null);
      setUserLogs([]);
    }
  }, [selectedUserId, navigate]);

  async function handleSaveUser() {
    /** persist edited user fields and refresh the list. */
    if (!selectedUser) return;
    setSaving(true);
    try {
      const updated = await updateUser(selectedUser.id, {
        name: editName,
        email: editEmail,
        role: editRole,
      });
      setSelectedUser(updated);
      fetchUsers();
    } catch {
      /* ignore */
    } finally {
      setSaving(false);
    }
  }

  async function handleResetPassword() {
    /** generate a password reset link for the selected user. */
    if (!selectedUser) return;
    try {
      const res = await resetPassword(selectedUser.id);
      setResetLink(window.location.origin + res.invitation_link);
    } catch {
      /* ignore */
    }
  }

  async function handleRemoveAirport(airportId: string) {
    /** remove an airport assignment from the selected user. */
    if (!selectedUser) return;
    const newIds = selectedUser.airports.flatMap((a) =>
      a.id !== airportId ? [a.id] : [],
    );
    try {
      const updated = await updateUserAirports(selectedUser.id, {
        airport_ids: newIds,
      });
      setSelectedUser(updated);
      fetchUsers();
    } catch {
      /* ignore */
    }
  }

  async function handleAddAirport(airportId: string) {
    /** add an airport assignment to the selected user. */
    if (!selectedUser) return;
    const currentIds = selectedUser.airports.map((a) => a.id);
    try {
      const updated = await updateUserAirports(selectedUser.id, {
        airport_ids: [...currentIds, airportId],
      });
      setSelectedUser(updated);
      fetchUsers();
    } catch {
      /* ignore */
    }
  }

  return {
    selectedUser,
    editName,
    editEmail,
    editRole,
    saving,
    resetLink,
    userLogs,
    setEditName,
    setEditEmail,
    setEditRole,
    handleSaveUser,
    handleResetPassword,
    handleRemoveAirport,
    handleAddAirport,
  };
}
