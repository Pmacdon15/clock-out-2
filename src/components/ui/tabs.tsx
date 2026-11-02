"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

const TabsContext = React.createContext<{
  value: string;
  onValueChange: (value: string) => void;
} | null>(null);

const Tabs = ({
  defaultValue,
  value: controlledValue,
  onValueChange,
  children,
  className,
}: {
  defaultValue?: string;
  value?: string;
  onValueChange?: (value: string) => void;
  children: React.ReactNode;
  className?: string;
}) => {
  const [value, setValue] = React.useState(
    controlledValue || defaultValue || "",
  );

  const handleValueChange = React.useCallback(
    (newValue: string) => {
      setValue(newValue);
      onValueChange?.(newValue);
    },
    [onValueChange],
  );

  const contextValue = React.useMemo(
    () => ({
      value: controlledValue !== undefined ? controlledValue : value,
      onValueChange: handleValueChange,
    }),
    [controlledValue, value, handleValueChange],
  );

  return (
    <TabsContext.Provider value={contextValue}>
      <div className={cn("w-full", className)}>{children}</div>
    </TabsContext.Provider>
  );
};

const TabsList = ({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) => (
  <div
    className={cn(
      // max-w-full + overflow-x-auto keeps a long tab row inside the screen
      // on phones (it scrolls sideways instead of widening the whole page).
      // justify-start so the first tab is never cut off when it scrolls.
      "inline-flex h-10 max-w-full items-center justify-start overflow-x-auto rounded-md bg-zinc-100 p-1 text-zinc-500 [scrollbar-width:none] dark:bg-zinc-900 dark:text-zinc-400 [&::-webkit-scrollbar]:hidden",
      className,
    )}
  >
    {children}
  </div>
);

const TabsTrigger = ({
  value,
  className,
  children,
}: {
  value: string;
  className?: string;
  children: React.ReactNode;
}) => {
  const context = React.useContext(TabsContext);
  if (!context) throw new Error("TabsTrigger must be used within Tabs");

  const isActive = context.value === value;

  return (
    <button
      className={cn(
        "inline-flex shrink-0 items-center justify-center whitespace-nowrap rounded-sm px-3 py-1.5 font-medium text-sm ring-offset-white transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-950 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 dark:ring-offset-zinc-950 dark:focus-visible:ring-zinc-300",
        isActive
          ? "bg-white text-zinc-950 shadow-sm dark:bg-zinc-800 dark:text-zinc-50"
          : "hover:text-zinc-900 dark:hover:text-zinc-50",
        className,
      )}
      onClick={() => context.onValueChange(value)}
      type="button"
    >
      {children}
    </button>
  );
};

const TabsContent = ({
  value,
  className,
  children,
}: {
  value: string;
  className?: string;
  children: React.ReactNode;
}) => {
  const context = React.useContext(TabsContext);
  if (!context) throw new Error("TabsContent must be used within Tabs");

  if (context.value !== value) return null;

  return (
    <div
      className={cn(
        "mt-2 ring-offset-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-950 focus-visible:ring-offset-2 dark:ring-offset-zinc-950 dark:focus-visible:ring-zinc-300",
        className,
      )}
    >
      {children}
    </div>
  );
};

export { Tabs, TabsContent, TabsList, TabsTrigger };
