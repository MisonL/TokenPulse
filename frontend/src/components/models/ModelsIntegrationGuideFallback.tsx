export function ModelsIntegrationGuideFallback() {
  return (
    <div className="flex flex-col gap-10 animate-slide-in">
      <div className="space-y-8">
        <div className="flex items-center gap-4">
          <div className="h-12 w-12 border-2 border-black bg-[#005C9A]" />
          <div className="h-10 w-48 bg-gray-100 border-2 border-black animate-pulse" />
        </div>
        <div className="h-72 border-4 border-black bg-gray-100 animate-pulse" />
      </div>
      <div className="space-y-8">
        <div className="flex items-center gap-4">
          <div className="h-12 w-12 border-2 border-black bg-[#DA0414]" />
          <div className="h-10 w-56 bg-gray-100 border-2 border-black animate-pulse" />
        </div>
        <div className="h-[42rem] border-4 border-black bg-gray-100 animate-pulse" />
      </div>
    </div>
  );
}
