'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { ButtonLink, PageLoading } from '@/components/ui';
import { useAuth } from '@/lib/auth';

export default function Home() {
  const { user } = useAuth();
  const router = useRouter();
  useEffect(() => {
    if (user) router.replace('/kits');
  }, [user, router]);

  if (user !== null) return <PageLoading />;
  return (
    <div className="mx-auto max-w-2xl py-12 text-center">
      <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
        Prepare for the interview you actually have.
      </h1>
      <p className="mt-4 text-slate-600">
        Paste a job description and the company&apos;s website. InterviewForge researches how the company
        hires, pulls out what the role really requires, and builds a kit: a company brief, likely questions,
        flashcards and a day-by-day plan for the days you have left.
      </p>
      <div className="mt-8 flex justify-center gap-3">
        <ButtonLink href="/register">Get started</ButtonLink>
        <ButtonLink href="/login" variant="secondary">
          Log in
        </ButtonLink>
      </div>
    </div>
  );
}
