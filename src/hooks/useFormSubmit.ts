import { useState, useCallback, useRef } from 'react';
import type { FormState, FormType, SubmitResult, UseFormSubmitReturn } from '../types';
import { submitLead } from '../lib/webhooks';

/**
 * Reusable hook that manages the full form-submission lifecycle:
 *   idle → loading → success | error
 *
 * Internally it:
 * 1. Calculates the lead score (inside `submitLead`).
 * 2. Sends the payload to the correct webhook.
 * 3. Handles errors and exposes a `reset()` for the consuming component.
 *
 * Usage:
 *   const { state, error, submit, reset } = useFormSubmit();
 *   await submit('calculator', formData);
 */
export function useFormSubmit(): UseFormSubmitReturn {
  const [state, setState] = useState<FormState>('idle');
  const [error, setError] = useState<string | null>(null);
  const submissionIds = useRef<Partial<Record<FormType, string>>>({});

  const submit = useCallback(
    async (formType: FormType, data: Record<string, unknown>): Promise<SubmitResult> => {
      setState('loading');
      setError(null);

      try {
        const existingSubmissionId = submissionIds.current[formType];
        const submissionId = existingSubmissionId ?? `${formType}_${
          typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
            ? crypto.randomUUID()
            : `${Date.now().toString(36)}${Math.random().toString(16).slice(2)}`
        }`;
        submissionIds.current[formType] = submissionId;

        const result = await submitLead(formType, {
          ...data,
          submission_id: submissionId,
        });

        if (result.success) {
          setState('success');
        } else {
          setState('error');
          setError(
            result.error ??
              'Ha ocurrido un error al enviar el formulario. Inténtalo de nuevo.',
          );
        }
        return result;
      } catch (err: unknown) {
        setState('error');
        setError(
          err instanceof Error
            ? err.message
            : 'Ha ocurrido un error inesperado.',
        );
        return { success: false, savedLocally: false, error: err instanceof Error ? err.message : 'Ha ocurrido un error inesperado.' };
      }
    },
    [],
  );

  const reset = useCallback(() => {
    setState('idle');
    setError(null);
    submissionIds.current = {};
  }, []);

  return { state, error, submit, reset } as const;
}
