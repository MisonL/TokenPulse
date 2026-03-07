interface SectionErrorBannerProps {
  title: string;
  error?: string;
  onRetry?: () => void;
  retryLabel?: string;
}

interface TableFeedbackRowProps {
  colSpan: number;
  error?: string;
  emptyMessage: string;
  onRetry?: () => void;
  retryLabel?: string;
}

export function SectionErrorBanner({
  title,
  error,
  onRetry,
  retryLabel = "重试加载",
}: SectionErrorBannerProps) {
  if (!error) return null;

  return (
    <div className="flex flex-col gap-3 border-2 border-black bg-[#FFE0E0] p-4 md:flex-row md:items-center md:justify-between">
      <div className="space-y-1">
        <p className="text-xs font-black uppercase tracking-[0.16em] text-red-700">{title}</p>
        <p className="text-xs font-bold text-red-700">{error}</p>
      </div>
      {onRetry ? (
        <button className="b-btn bg-white text-xs" onClick={onRetry}>
          {retryLabel}
        </button>
      ) : null}
    </div>
  );
}

export function TableFeedbackRow({
  colSpan,
  error,
  emptyMessage,
  onRetry,
  retryLabel = "重试",
}: TableFeedbackRowProps) {
  if (!error) {
    return (
      <tr>
        <td className="p-3 text-gray-500 font-bold" colSpan={colSpan}>
          {emptyMessage}
        </td>
      </tr>
    );
  }

  return (
    <tr>
      <td className="p-3" colSpan={colSpan}>
        <div className="flex flex-col gap-3 border-2 border-black bg-[#FFE0E0] p-3 md:flex-row md:items-center md:justify-between">
          <div className="space-y-1 text-red-700">
            <p className="text-xs font-black uppercase tracking-[0.16em]">加载失败</p>
            <p className="text-xs font-bold">{error}</p>
          </div>
          {onRetry ? (
            <button className="b-btn bg-white text-xs" onClick={onRetry}>
              {retryLabel}
            </button>
          ) : null}
        </div>
      </td>
    </tr>
  );
}
