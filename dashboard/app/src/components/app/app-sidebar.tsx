// The sidebar shell. Nav comes from nav.ts so a page cannot exist in one place and not the other.
import { Icon } from "../icon";
import { NAV } from "./nav";
import { buildHash, RANGE_LABELS } from "@/lib/route";
import type { RangeId } from "@/lib/route";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  SidebarSeparator,
} from "@/components/ui/sidebar";

export function AppSidebar({
  page,
  range,
  status,
  version,
  onOpen,
  onShare,
  onSettings,
}: {
  page: string;
  range: RangeId;
  status: string | null;
  version: string | null;
  onOpen: (page: string) => void;
  onShare: () => void;
  onSettings: () => void;
}) {
  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" tooltip="Tersio — usage dashboard">
              <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent">
                <Icon name="scissors" className="size-4" />
              </span>
              <span className="grid min-w-0 flex-1 text-left leading-tight">
                <span className="truncate text-[13px] font-semibold">Tersio</span>
                <span className="mono truncate text-[10px] text-dim">{version ? `v${version}` : "usage"}</span>
              </span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        {NAV.map((group) => (
          <SidebarGroup key={group.label}>
            <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map((item) => {
                  const active = item.id === page;
                  return (
                    <SidebarMenuItem key={item.id}>
                      <SidebarMenuButton
                        isActive={active}
                        tooltip={item.label}
                        render={
                          <a
                            href={buildHash(item.id, range)}
                            aria-current={active ? "page" : undefined}
                            onClick={(e) => {
                              // Plain clicks stay in-page; modified clicks keep their browser meaning.
                              if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
                              e.preventDefault();
                              onOpen(item.id);
                            }}
                          />
                        }
                      >
                        <Icon name={item.icon} className="size-4" />
                        <span>{item.label}</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>

      <SidebarFooter>
        {status && (
          <p className="mono m-0 truncate px-2 text-[10px] text-dim" title={status}>
            {status}
          </p>
        )}
        <p className="mono m-0 px-2 text-[10px] text-dim">Range: {RANGE_LABELS[range]}</p>
        <SidebarSeparator />
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton tooltip="Share your usage" onClick={onShare}>
              <Icon name="share-2" className="size-4" />
              <span>Share</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton tooltip="Settings" onClick={onSettings}>
              <Icon name="settings" className="size-4" />
              <span>Settings</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
