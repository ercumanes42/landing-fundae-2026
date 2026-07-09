import { useState, useCallback } from 'react';
import type { FormState, FormType, UseFormSubmitReturn } from '../types';
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

  const submit = useCallback(
    async (formType: FormType, data: Record<string, unknown>): Promise<void> => {
      setState('loading');
      setError(null);

      try {
        const result = await submitLead(formType, data);

        if (result.success || result.savedLocally) {
          setState('success');
        } else {
          setState('error');
          setError(
            result.error ??
              'Ha ocurrido un error al enviar el formulario. Inténtalo de nuevo.',
          );
        }
      } catch (err: unknown) {
        setState('error');
        setError(
          err instanceof Error
            ? err.message
            : 'Ha ocurrido un error inesperado.',
        );
      }
    },
    [],
  );

  const reset = useCallback(() => {
    setState('idle');
    setError(null);
  }, []);

  return { state, error, submit, reset } as const;
}
