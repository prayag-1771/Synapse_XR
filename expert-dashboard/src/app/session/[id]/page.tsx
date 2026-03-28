import SessionRouteClient from "@/components/session-route-client";

interface SessionPageProps {
  params: Promise<{ id: string }>;
}

export default async function SessionPage({ params }: SessionPageProps) {
  const { id } = await params;
  return <SessionRouteClient sessionId={id} />;
}
