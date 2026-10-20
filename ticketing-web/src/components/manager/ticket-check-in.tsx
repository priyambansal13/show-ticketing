'use client';

import { CheckCircle2, XCircle } from 'lucide-react';
import { useRef, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FormError } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { errorMessage, isApiError } from '@/lib/api/errors';
import { useVerifyTicket } from '@/lib/api/hooks/manager';
import type { TicketVerification } from '@/lib/api/types';
import { formatDateTime } from '@/lib/format';
import { DefinitionList, PageHeader } from './page-parts';

const REASON: Record<NonNullable<TicketVerification['reason']>, string> = {
  NOT_CONFIRMED: 'This booking is not confirmed (unpaid, expired or cancelled).',
  ALREADY_CHECKED_IN: 'This ticket was already used.',
  SHOW_CANCELLED: 'This show has been cancelled.',
};

export function TicketCheckIn() {
  const verify = useVerifyTicket();
  const input = useRef<HTMLInputElement>(null);
  const [code, setCode] = useState('');
  const [inputError, setInputError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<TicketVerification | null>(null);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const trimmed = code.trim();
    setResult(null);
    setError(null);
    if (trimmed.length < 10 || trimmed.length > 200) {
      setInputError('Enter the full ticket code (it starts with TKT1.).');
      return;
    }
    setInputError(null);
    try {
      setResult(await verify.mutateAsync(trimmed));
      setCode('');
    } catch (err) {
      setError(
        isApiError(err) && (err.code === 'TICKET_INVALID' || err.status === 404)
          ? 'Invalid ticket — this code was not issued for your shows.'
          : errorMessage(err),
      );
    } finally {
      input.current?.focus();
    }
  };

  return (
    <>
      <PageHeader
        title="Ticket check-in"
        description="Scan the QR code with a handheld scanner (it types the code) or paste it. Each ticket can be checked in once."
      />
      <div className="grid max-w-4xl gap-6 lg:grid-cols-2">
        <Card>
          <CardContent className="pt-5">
            <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
              <Field label="Ticket code" error={inputError ?? undefined}>
                <Input
                  ref={input}
                  value={code}
                  onChange={(event) => setCode(event.target.value)}
                  autoComplete="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  autoFocus
                  placeholder="TKT1.…"
                />
              </Field>
              <Button type="submit" loading={verify.isPending} className="w-fit">
                Check in
              </Button>
            </form>
          </CardContent>
        </Card>

        <div aria-live="assertive" aria-atomic="true">
          <FormError message={error} />
          {result ? (
            <Card className={result.valid ? 'border-success' : 'border-danger'}>
              <CardHeader>
                <CardTitle className={`flex items-center gap-2 ${result.valid ? 'text-success' : 'text-danger'}`}>
                  {result.valid ? <CheckCircle2 aria-hidden className="size-6" /> : <XCircle aria-hidden className="size-6" />}
                  {result.valid ? 'Valid — admit' : 'Do not admit'}
                </CardTitle>
                {!result.valid && result.reason ? <p className="text-sm">{REASON[result.reason]}</p> : null}
              </CardHeader>
              <CardContent>
                <DefinitionList
                  items={[
                    { term: 'Booking', value: <span className="font-mono">{result.booking.bookingRef}</span> },
                    { term: 'Event', value: result.booking.show?.eventTitle ?? '—' },
                    { term: 'Show', value: result.booking.show ? formatDateTime(result.booking.show.startsAt) : '—' },
                    {
                      term: 'Hall',
                      value: result.booking.show ? `${result.booking.show.venueName} · ${result.booking.show.hallName}` : '—',
                    },
                    { term: 'Seats', value: result.booking.seats.map((seat) => seat.seatId).join(', ') },
                    { term: 'Checked in', value: result.checkedInAt ? formatDateTime(result.checkedInAt) : '—' },
                  ]}
                />
              </CardContent>
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}
