export function BuiltOnNear({
  tone,
  className = "",
}: {
  readonly tone: "dark" | "light";
  readonly className?: string;
}) {
  return (
    <a
      href="https://near.dev"
      target="_blank"
      rel="noreferrer"
      className={`inline-block opacity-90 transition-opacity hover:opacity-100 ${className}`}
    >
      <img
        src={tone === "light" ? "/images/built-on-near-white.png" : "/images/built-on-near.png"}
        alt="Built on NEAR"
        width={1200}
        height={199}
        className="h-full w-auto"
      />
    </a>
  );
}
