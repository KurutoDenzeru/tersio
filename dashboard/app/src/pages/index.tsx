// The route switch. One string in, one page out; nav.ts owns the list.
import { EmptyState } from "@/components/dash/composites";
import { CostsPage } from "./costs";
import { ErrorsPage } from "./errors";
import { FrustrationPage } from "./frustration";
import { GainPage } from "./gain";
import { ModelsPage } from "./models";
import { OverviewPage } from "./overview";
import { ProjectsPage } from "./projects";
import { ProvidersPage } from "./providers";
import { RequestsPage } from "./requests";
import { ToolsPage } from "./tools";
import { TracesPage } from "./traces";
import type { PageProps } from "./types";

function UnknownPage({ page }: { page: string }) {
  return (
    <EmptyState
      title="No such page"
      body={`"${page}" is not a dashboard page. Pick one from the sidebar.`}
    />
  );
}

export function PageBody({ page, ...props }: PageProps & { page: string }) {
  switch (page) {
    case "overview":
      return <OverviewPage {...props} />;
    case "models":
      return <ModelsPage {...props} />;
    case "providers":
      return <ProvidersPage {...props} />;
    case "costs":
      return <CostsPage {...props} />;
    case "requests":
      return <RequestsPage {...props} />;
    case "errors":
      return <ErrorsPage {...props} />;
    case "traces":
      return <TracesPage {...props} />;
    case "tools":
      return <ToolsPage {...props} />;
    case "frustration":
      return <FrustrationPage {...props} />;
    case "projects":
      return <ProjectsPage {...props} />;
    case "gain":
      return <GainPage {...props} />;
    default:
      return <UnknownPage page={page} />;
  }
}
