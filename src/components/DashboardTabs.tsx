"use client";

import { Suspense, use } from "react";
import type { SerializableResult, TimeEntry } from "@/lib/dal";
import ManageHours from "./ManageHours";
import { Card } from "./ui";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";
import ViewHours from "./ViewHours";

interface DashboardTabsProps {
  entriesPromise: Promise<SerializableResult<TimeEntry[], { reason: string }>>;
  isAdminPromise?: Promise<
    SerializableResult<
      { userId: string; orgId: string; isAdmin: boolean },
      { reason: string }
    >
  >;
  membersPromise?: Promise<
    {
      id: string;
      name: string;
    }[]
  >;
  selectedUserIdPromise?: Promise<string | undefined>;
}

export default function DashboardTabs({
  entriesPromise,
  isAdminPromise,
  membersPromise,
  selectedUserIdPromise,
}: DashboardTabsProps) {
  const result = use(entriesPromise);

  if (!result.ok) {
    return (
      <Card className="p-8 text-center text-red-500">
        {"Error fetching time entries: "}
        {result.error.reason}
      </Card>
    );
  }

  const entries: TimeEntry[] = result?.value ?? [];
  const isAdminResult = isAdminPromise ? use(isAdminPromise) : undefined;

  const isAdmin = isAdminResult?.ok ? isAdminResult.value.isAdmin : false;
  const currentUserId = isAdminResult?.ok ? isAdminResult.value.userId : undefined;

  return (
    <Tabs defaultValue="manage" className="space-y-8">
      <TabsList>
        <TabsTrigger value="manage">Manage Hours</TabsTrigger>
        <TabsTrigger value="view">View Hours</TabsTrigger>
      </TabsList>

      <TabsContent value="manage" className="mt-0">
        <ManageHours initialEntries={entries} isAdmin={isAdmin || false} />
      </TabsContent>

      <TabsContent value="view" className="mt-0">
        <Suspense>
          <ViewHours
            entries={entries}
            membersPromise={membersPromise}
            isAdmin={isAdmin}
            selectedUserIdPromise={selectedUserIdPromise}
            currentUserId={currentUserId}
          />
        </Suspense>
      </TabsContent>
    </Tabs>
  );
}
