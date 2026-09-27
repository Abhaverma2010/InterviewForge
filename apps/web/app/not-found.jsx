import { ButtonLink, EmptyState } from '@/components/ui';

export default function NotFound() {
  return (
    <EmptyState title="Page not found" action={<ButtonLink href="/kits">Go to my kits</ButtonLink>}>
      The page you were looking for does not exist.
    </EmptyState>
  );
}
