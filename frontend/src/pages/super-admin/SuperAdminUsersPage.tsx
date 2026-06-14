import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router";
import {
  ListPageContainer,
  ListPageContent,
  SearchBar,
  Pagination,
} from "@/components/common/ListPageLayout";
import Button from "@/components/common/Button";
import InviteUserDialog from "@/components/admin/InviteUserDialog";
import UsersTable from "@/components/admin/UsersTable";
import UserConfirmActionModal from "@/components/admin/UserConfirmActionModal";
import SuperAdminUserDetail from "./SuperAdminUserDetail";
import useSuperAdminUsersList from "@/hooks/useSuperAdminUsersList";
import useSuperAdminUserDetail from "@/hooks/useSuperAdminUserDetail";

/** super-admin users list page with filter bar, server pagination, and detail view. */
export default function SuperAdminUsersPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { id: selectedUserId } = useParams<{ id: string }>();
  const [inviteOpen, setInviteOpen] = useState(false);

  const list = useSuperAdminUsersList();
  const detail = useSuperAdminUserDetail({
    selectedUserId,
    fetchUsers: list.fetchUsers,
    navigate,
  });

  // detail view
  if (detail.selectedUser) {
    return (
      <SuperAdminUserDetail
        user={detail.selectedUser}
        allAirports={list.allAirports}
        userLogs={detail.userLogs}
        editName={detail.editName}
        editEmail={detail.editEmail}
        editRole={detail.editRole}
        saving={detail.saving}
        resetLink={detail.resetLink}
        onEditNameChange={detail.setEditName}
        onEditEmailChange={detail.setEditEmail}
        onEditRoleChange={detail.setEditRole}
        onBack={() => navigate("/super-admin/users")}
        onSave={detail.handleSaveUser}
        onResetPassword={detail.handleResetPassword}
        onRemoveAirport={detail.handleRemoveAirport}
        onAddAirport={detail.handleAddAirport}
        onConfirmAction={list.setConfirmAction}
      />
    );
  }

  // list view
  return (
    <ListPageContainer data-testid="admin-users-page">
      {/* standalone search bar with the invite-user action inline */}
      <SearchBar
        value={list.search}
        onChange={(e) => {
          list.setSearch(e.target.value);
          list.setPage(0);
        }}
        placeholder={t("admin.searchUsers")}
        testId="user-search"
      >
        <Button variant="danger" onClick={() => setInviteOpen(true)}>
          + {t("admin.inviteUser")}
        </Button>
      </SearchBar>

      <ListPageContent>
        {/* filter row: role + status pills, last_login + created_at date ranges */}
        <div className="w-full mb-4">{list.bar}</div>

        <UsersTable
          loading={list.loading}
          isEmpty={list.users.length === 0}
          rows={list.sortedUsers}
          sortKey={list.sortKey}
          sortDir={list.sortDir}
          onSort={list.handleSort}
          onSelectUser={(userId) => navigate(`/super-admin/users/${userId}`)}
          onConfirmAction={list.setConfirmAction}
        />

        <Pagination
          page={list.page}
          pageSize={list.pageSize}
          totalItems={
            // if any client-side filter narrowed the rows, paginate over those
            list.filteredUsers.length !== list.users.length
              ? list.filteredUsers.length
              : list.total
          }
          onPageChange={list.setPage}
          onPageSizeChange={(s) => {
            list.setPageSize(s);
            list.setPage(0);
          }}
          showingKey="admin.pagination"
        />
      </ListPageContent>

      <InviteUserDialog
        isOpen={inviteOpen}
        onClose={() => setInviteOpen(false)}
        onSuccess={list.fetchUsers}
        airports={list.allAirports}
      />

      <UserConfirmActionModal
        action={list.confirmAction}
        onCancel={() => list.setConfirmAction(null)}
        onConfirm={list.handleConfirmAction}
      />
    </ListPageContainer>
  );
}
