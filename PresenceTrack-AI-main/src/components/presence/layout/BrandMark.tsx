import { cn } from "@/lib/utils";

export interface BrandMarkProps {
  size?: "sm" | "md" | "lg" | "xl";
  className?: string;
  showText?: boolean;
  textClassName?: string;
}

const SIZE_CLASSES = {
  sm: "h-7 w-7",
  md: "h-9 w-9",
  lg: "h-12 w-12",
  xl: "h-16 w-16",
};

export function BrandMark({
  size = "md",
  className,
  showText = false,
  textClassName,
}: BrandMarkProps) {
  const iconElement = (
    <div
      className={cn(
        "relative flex shrink-0 items-center justify-center select-none",
        SIZE_CLASSES[size],
        className,
      )}
    >
      {/* Light Theme Logo Mark from user branding */}
      <img
        src="/assets/logo-icon-transparent.png"
        alt="PresenceTrack AI"
        className="h-full w-full object-contain dark:hidden"
        loading="eager"
      />
      {/* Dark Theme Logo Mark from user branding */}
      <img
        src="/assets/logo-dark-transparent.png"
        alt="PresenceTrack AI"
        className="hidden h-full w-full object-contain dark:block"
        loading="eager"
      />
    </div>
  );

  if (!showText) {
    return iconElement;
  }

  return (
    <div className="flex items-center gap-2.5 select-none">
      {iconElement}
      <div className={cn("flex items-center tracking-tight font-extrabold", textClassName)}>
        <span className="text-umbra">PRESENCETRACK</span>
        <span className="ml-1 text-emerald-500">AI</span>
      </div>
    </div>
  );
}
