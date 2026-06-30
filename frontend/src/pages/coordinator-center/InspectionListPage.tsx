import { useState, useEffect, useMemo, useCallback } from "react";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";
import { useAirport } from "@/contexts/AirportContext";
import {
  listInspectionTemplates,
  createInspectionTemplate,
  deleteInspectionTemplate,
  bulkCreateInspectionTemplates,
} from "@/api/inspectionTemplates";
import type { InspectionTemplateResponse } from "@/types/inspectionTemplate";
import type { AGLResponse } from "@/types/airport";
import type { InspectionMethod } from "@/types/enums";
import { formatAglDisplayName } from "@/utils/agl";
import { ALL_INSPECTION_METHODS } from "@/utils/methodAglCompatibility";
import { methodBadgeStyle } from "@/utils/inspectionMethodBadge";
import InspectionTemplateTable from "@/components/mission/InspectionTemplateTable";
import CreateTemplateDialog from "@/components/mission/CreateTemplateDialog";
import BulkCreateTemplatesDialog from "@/components/mission/BulkCreateTemplatesDialog";
import Modal from "@/components/common/Modal";
import Button from "@/components/common/Button";
import {
  ListPageContainer,
  ListPageContent,
  SearchBar,
  Pagination,
} from "@/components/common/ListPageLayout";
import useListFilters from "@/components/common/useListFilters";
import useToast from "@/hooks/useToast";
import type { FilterSpec } from "@/components/common/filterSpec";
import { SLOW_NOTIFICATION_TIMEOUT_MS } from "@/constants/ui";
import { DEFAULT_PAGE_SIZE } from "@/constants/pagination";

/** inspection template list page, styled like the missions list page. */
export default function InspectionListPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { airportDetail } = useAirport();

  const [templates, setTemplates] = useState<InspectionTemplateResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // search kept outside the spec so the SearchBar can host the action buttons
  const [search, setSearch] = useState("");

  const [showCreate, setShowCreate] = useState(false);
  const [showBulk, setShowBulk] = useState(false);

  // pagination
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);

  // delete confirmation
  const [deleteTarget, setDeleteTarget] = useState<InspectionTemplateResponse | null>(null);

  // notification toast
  const { message: notification, show: showNotif } = useToast(SLOW_NOTIFICATION_TIMEOUT_MS);

  // all agls from airport
  const allAgls = useMemo(() => {
    if (!airportDetail) return [];
    return airportDetail.surfaces.flatMap((s) => s.agls);
  }, [airportDetail]);

  const aglMap = useMemo(
    () => new Map<string, AGLResponse>(allAgls.map((a) => [a.id, a])),
    [allAgls],
  );

  const fetchTemplates = useCallback(async (signal?: AbortSignal) => {
    /**fetch templates for the selected airport.*/
    setLoading(true);
    setError(null);
    try {
      const res = await listInspectionTemplates(
        airportDetail ? { airport_id: airportDetail.id } : undefined,
        signal,
      );
      if (!signal?.aborted) setTemplates(res.data);
    } catch (err) {
      if (signal?.aborted) return;
      setError(err instanceof Error ? err.message : t("coordinator.inspections.loadError"));
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [airportDetail, t]);

  useEffect(() => {
    if (!airportDetail) return;
    const controller = new AbortController();
    fetchTemplates(controller.signal);
    return () => controller.abort();
  }, [fetchTemplates, airportDetail]);

  // filter spec - method pills (none-active, multi, arrayValued) + array-valued agl select
  const filterSpec = useMemo<FilterSpec<InspectionTemplateResponse>[]>(
    () => [
      {
        kind: "pills",
        field: "methods",
        multi: true,
        defaultMode: "none-active",
        arrayValued: true,
        options: ALL_INSPECTION_METHODS.map((m) => ({
          value: m,
          label: t(`map.inspectionMethod.${m}`),
        })),
        badgeStyle: methodBadgeStyle,
        testIdPrefix: "method-pill",
      },
      {
        kind: "select",
        field: "target_agl_ids",
        arrayValued: true,
        options: allAgls.map((agl) => ({
          value: agl.id,
          label: formatAglDisplayName(agl),
        })),
        placeholder: t("coordinator.inspections.allAglSystems"),
        testId: "agl-filter",
      },
    ],
    [t, allAgls],
  );

  const onFiltersChange = useCallback(() => setPage(0), []);
  const { filteredRows, bar } = useListFilters(templates, filterSpec, {
    onFiltersChange,
  });

  // search runs in addition to spec filters
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return filteredRows;
    return filteredRows.filter((tpl) => tpl.name.toLowerCase().includes(q));
  }, [filteredRows, search]);

  function handleSearchChange(e: React.ChangeEvent<HTMLInputElement>) {
    /**update search and reset page.*/
    setSearch(e.target.value);
    setPage(0);
  }

  async function handleCreate(data: { name: string; aglId: string; method: InspectionMethod }) {
    /**create a new template and navigate to it.*/
    try {
      const result = await createInspectionTemplate({
        name: data.name,
        target_agl_ids: data.aglId ? [data.aglId] : [],
        methods: [data.method],
      });
      setShowCreate(false);
      navigate(`/coordinator-center/inspections/${result.id}`);
    } catch (err) {
      showNotif(err instanceof Error ? err.message : t("coordinator.inspections.createError"));
    }
  }

  async function handleDuplicate(id: string) {
    /**duplicate a template and navigate to the copy.*/
    const tpl = templates.find((tmpl) => tmpl.id === id);
    if (!tpl) return;
    try {
      const result = await createInspectionTemplate({
        name: `${tpl.name} (Copy)`,
        target_agl_ids: tpl.target_agl_ids,
        methods: tpl.methods,
      });
      navigate(`/coordinator-center/inspections/${result.id}`);
    } catch (err) {
      showNotif(err instanceof Error ? err.message : t("coordinator.inspections.duplicateError"));
    }
  }

  function handleDeleteClick(id: string) {
    /**open delete confirmation for a template.*/
    const tpl = templates.find((tmpl) => tmpl.id === id);
    if (tpl) setDeleteTarget(tpl);
  }

  async function handleDeleteConfirm() {
    /**confirm and execute template deletion.*/
    if (!deleteTarget) return;
    try {
      await deleteInspectionTemplate(deleteTarget.id);
      setDeleteTarget(null);
      await fetchTemplates();
    } catch (err) {
      setDeleteTarget(null);
      showNotif(err instanceof Error ? err.message : t("coordinator.inspections.deleteError"));
    }
  }

  // airport guard
  if (!airportDetail) {
    return (
      <div className="flex items-center justify-center h-full bg-tv-bg" data-testid="inspection-list-page">
        <p className="text-sm text-tv-text-muted">
          {t("coordinator.inspections.selectAirportFirst")}
        </p>
      </div>
    );
  }

  return (
    <ListPageContainer>
      {/* search bar */}
      <SearchBar
        value={search}
        onChange={handleSearchChange}
        placeholder={t("coordinator.inspections.searchPlaceholder")}
        testId="template-search"
      >
        <Button variant="secondary" onClick={() => setShowBulk(true)} data-testid="bulk-create-btn">
          {t("coordinator.inspections.bulkCreate")}
        </Button>
        <Button onClick={() => setShowCreate(true)} data-testid="add-template-btn">
          {t("coordinator.inspections.addNew")}
        </Button>
      </SearchBar>

      {/* filter row */}
      <ListPageContent className="mb-4">{bar}</ListPageContent>

      {/* template table */}
      <div className="w-full max-w-6xl rounded-2xl border border-tv-border bg-tv-surface overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-tv-text-muted" />
          </div>
        ) : error ? (
          <div className="px-6 py-16 text-center text-sm text-tv-error">
            {error}
            <button type="button" onClick={() => fetchTemplates()} className="ml-2 underline hover:no-underline">
              {t("common.retry")}
            </button>
          </div>
        ) : templates.length === 0 ? (
          <div className="px-6 py-16 text-center text-sm text-tv-text-muted">
            {t("coordinator.inspections.noTemplates")}
          </div>
        ) : filtered.length === 0 ? (
          <div className="px-6 py-16 text-center text-sm text-tv-text-muted">
            {t("coordinator.inspections.noMatch")}
          </div>
        ) : (
          <InspectionTemplateTable
            templates={filtered}
            aglMap={aglMap}
            onRowClick={(id) => navigate(`/coordinator-center/inspections/${id}`)}
            onDuplicate={handleDuplicate}
            onDelete={handleDeleteClick}
            page={page + 1}
            pageSize={pageSize}
          />
        )}
      </div>

      {/* pagination */}
      {!loading && !error && filtered.length > 0 && (
        <Pagination
          page={page}
          pageSize={pageSize}
          totalItems={filtered.length}
          onPageChange={setPage}
          onPageSizeChange={(size) => { setPageSize(size); setPage(0); }}
          showingKey="coordinator.inspections.showing"
        />
      )}

      <CreateTemplateDialog
        isOpen={showCreate}
        onClose={() => setShowCreate(false)}
        agls={allAgls}
        onSubmit={handleCreate}
      />

      <BulkCreateTemplatesDialog
        isOpen={showBulk}
        onClose={() => setShowBulk(false)}
        agls={allAgls}
        existingTemplates={templates}
        onSubmit={async () => {
          if (!airportDetail) throw new Error("no airport loaded");
          const result = await bulkCreateInspectionTemplates(airportDetail.id);
          showNotif(
            t("coordinator.inspections.bulkCreateSuccess", { count: result.created.length }),
          );
          await fetchTemplates();
        }}
      />

      {/* delete confirmation */}
      <Modal
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        title={t("coordinator.inspections.deleteTemplate")}
      >
        <p className="text-sm text-tv-text-secondary mb-4">
          {t("coordinator.inspections.deleteConfirm", { name: deleteTarget?.name ?? "" })}
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setDeleteTarget(null)}>
            {t("common.cancel")}
          </Button>
          <Button variant="danger" onClick={handleDeleteConfirm}>
            {t("common.delete")}
          </Button>
        </div>
      </Modal>

      {/* notification toast */}
      {notification && (
        <div className="fixed bottom-6 right-6 z-50 px-4 py-3 rounded-2xl bg-tv-surface border border-tv-border text-sm text-tv-text-primary">
          {notification}
        </div>
      )}
    </ListPageContainer>
  );
}
