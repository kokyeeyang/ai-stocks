import "./globals.css";
export const metadata = {
  title: "AI Stock Analyzer",
  description: "AI-powered stock analysis tool",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: "system-ui" }}>{children}</body>
    </html>
  );
}
