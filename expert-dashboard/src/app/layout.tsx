export const metadata = {
  title: "Synapse XR - Expert Dashboard",
  description: "Remote expert guidance system",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
