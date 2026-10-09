import type { ReactNode } from "react";

/**
 * Lightweight stand-ins for Recharts. jsdom has no layout engine, so the real
 * charts render nothing; these expose the props the app passes in so tests can
 * assert on chart data and series configuration.
 */

type Props = { children?: ReactNode; [key: string]: unknown };

const chart =
  (testId: string) =>
  ({ children, data }: Props) => (
    <div data-chart={JSON.stringify(data)} data-testid={testId}>
      {children}
    </div>
  );

export const ResponsiveContainer = ({ children }: Props) => <>{children}</>;
export const BarChart = chart("bar-chart");
export const LineChart = chart("line-chart");
export const CartesianGrid = () => null;
export const XAxis = () => null;
export const YAxis = () => null;
export const Legend = () => <div data-testid="legend" />;

export const Tooltip = ({
  labelFormatter,
}: {
  labelFormatter: (
    value: string,
    payload: { payload: { fullLabel?: string } }[],
  ) => string;
}) => (
  <div data-testid="tooltip">
    <span>{labelFormatter("short", [{ payload: { fullLabel: "Full" } }])}</span>
    <span>{labelFormatter("short", [])}</span>
  </div>
);

const series =
  (testId: string) =>
  ({ children, dataKey, hide, radius, name }: Props) => (
    <div
      data-hidden={String(Boolean(hide))}
      data-key={String(dataKey)}
      data-name={name === undefined ? undefined : String(name)}
      data-radius={JSON.stringify(radius)}
      data-testid={testId}
    >
      {children}
    </div>
  );

export const Bar = series("bar");
export const Line = series("line");
export const Cell = () => <span data-testid="cell" />;
export const LabelList = () => <span data-testid="label-list" />;
