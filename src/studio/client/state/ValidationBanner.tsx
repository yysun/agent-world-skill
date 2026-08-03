// Lists every current validation error (REQ Acceptance Criteria -> Saving
// and validation feedback). Errors whose pointer names a specific node are
// also highlighted on the canvas itself (Canvas.tsx); this banner is the
// one place every error appears regardless of pointer shape, so an error
// against an agent, a world field, or something the pointer parser doesn't
// recognize is never silently dropped.
import type { ValidationError } from '../../shared/models.js';

export interface ValidationBannerProps {
  errors: ValidationError[];
}

export function ValidationBanner({ errors }: ValidationBannerProps): JSX.Element | null {
  if (errors.length === 0) return null;
  return (
    <div className="studio-validation-banner" role="alert">
      <strong>Validation errors:</strong>
      <ul>
        {errors.map((err, index) => (
          <li key={`${err.pointer}-${index}`} className="studio-validation-error">
            {err.pointer ? `${err.pointer}: ` : ''}
            {err.message}
          </li>
        ))}
      </ul>
    </div>
  );
}
