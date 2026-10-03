import { createFileRoute } from "@tanstack/react-router";
import { FileSpreadsheet, GitCompare } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FbCompare, VersionCompare } from "@/components/compare-views";

export const Route = createFileRoute("/_authenticated/compare")({
  head: () => ({
    meta: [
      { title: "Dữ liệu so sánh — Dispatch Board" },
      { name: "description", content: "Đối chiếu file Excel crewlist với FliteBrief và so hai bản kế hoạch bay." },
      { property: "og:title", content: "Dữ liệu so sánh — Dispatch Board" },
      { property: "og:description", content: "Đối chiếu file Excel crewlist với FliteBrief và so hai bản kế hoạch bay." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => (
    <AppShell>
      <Tabs defaultValue="fb" className="space-y-3">
        <TabsList>
          <TabsTrigger value="fb"><FileSpreadsheet className="mr-1 h-4 w-4" />Excel ↔ FliteBrief</TabsTrigger>
          <TabsTrigger value="ver"><GitCompare className="mr-1 h-4 w-4" />So 2 bản kế hoạch</TabsTrigger>
        </TabsList>
        <TabsContent value="fb"><FbCompare /></TabsContent>
        <TabsContent value="ver"><VersionCompare /></TabsContent>
      </Tabs>
    </AppShell>
  ),
});

