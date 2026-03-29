"use client";

import { use } from "react";
import type { TimeEntry, SerializableResult } from "@/lib/dal";
import ManageHours from "./ManageHours";
import { Card } from "./ui";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";
import ViewHours from "./ViewHours";

interface DashboardTabsProps {
  entriesPromise: Promise<SerializableResult<TimeEntry[], { reason: string }>>;
}

export default function DashboardTabs({ entriesPromise }: DashboardTabsProps) {
  const result = use(entriesPromise);

  // Handle errors if needed
  if (!result.ok) {
    return (
      <Card className="p-8 text-center text-red-500">
        {"Error fetching time entries: "}{result.error.reason}
      </Card>
    );
  }

  const entries: TimeEntry[] = result?.value ?? [];

  return (
    <Tabs defaultValue="manage" className="space-y-8">
      <TabsList>
        <TabsTrigger value="manage">Manage Hours</TabsTrigger>
        <TabsTrigger value="view">View Hours</TabsTrigger>
      </TabsList>

      <TabsContent value="manage" className="mt-0">
        <ManageHours initialEntries={entries} />
      </TabsContent>

      <TabsContent value="view" className="mt-0">
        <ViewHours entries={entries} />
      </TabsContent>
    </Tabs>
  );
}
