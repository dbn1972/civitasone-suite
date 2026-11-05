# Error-message standard

One plain-language standard for everything that can go wrong in the web app. It is
the default: no call site opts in. Code lives in `src/lib/errorCatalogue.ts`
(catalogue, en + hi) and `src/lib/messages.ts` (`humanErrorForStatus`,
`humanErrorFromFailure`). Every helper that turns a failure into words goes through them:
`errorMessageFromResponse` / `browserJson` (`lib/api/browserClient.ts`),
`useFormError`, `LoadErrorState`, `RouteError` (every `error.tsx`), `FileUpload`,
`PermissionDenied`.

Based on:

- GOV.UK Design System: error message and error summary components.
- Nielsen Norman Group: error-message guidelines (say what happened, be specific,
  be polite, offer a way forward, keep what the user typed).
- WCAG 2.2: SC 3.3.1 Error Identification, SC 3.3.3 Error Suggestion,
  SC 4.1.3 Status Messages.

## Rules

1. Say what happened and what the user can do next, in plain words.
2. No blame, jargon, codes, stack text or raw backend messages. Never show an HTTP
   status number, a backend `code` or the backend `message`. (CI:
   `scripts/ci/raw-status-leak-guard.mjs`.)
3. Avoid "error", "oops", "invalid", "failed to" and "something went wrong" on their own.
4. Sentence case. One or two short sentences. Name the action and object where known:
   "We couldn't save the leave request."
5. Field messages come from the backend `fieldErrors` when it sends them (they are
   authored as user-safe copy). Show each next to its field, plus an error summary at
   the top of the form (`ErrorSummary`). Focus moves to the summary and it is a
   `role="alert"` region, so it is announced.
6. A support reference (correlation / request id, from the `x-correlation-id` or
   `x-request-id` response header, or the Next.js error digest) is shown as a quiet
   secondary line, "Reference: XXXX", never as the main message.
7. Network failures keep the user's input. Helpers never touch form values.

## Default mapping

Precedence: known domain `code` first, then HTTP status. No status at all (the request
never reached us) is a network failure.

| Status | Message |
| --- | --- |
| 400 / 422 | With field errors: Some details need changing. Check the highlighted fields and try again. Without: Some details weren't accepted. Check what you entered and try again. |
| 401 | Your session has ended. Sign in again to continue. (+ Sign in action) |
| 403 | You don't have permission to do this. Ask your administrator if you need access. |
| 404 | We couldn't find this {object}. It may have been removed or the link may be wrong. |
| 409 / 412 | This {object} was changed by someone else. Refresh to see the latest version, then try again. |
| 413 | The file is too large. Upload a file smaller than {limit}. |
| 415 | This file type isn't accepted. Upload a {types} file. |
| 429 | Too many attempts. Wait a minute, then try again. |
| 5xx / other | We couldn't {verb} the {object} because of a problem on our side. Your changes haven't been saved. Try again in a few minutes. (Loads drop the "changes" sentence.) |
| Timeout (408, 504, our own request timeout) | We couldn't {verb} the {object} in time. The system is taking longer than usual. Check whether your changes were saved before you try again. (Loads: Try again in a few minutes.) |
| Network: a genuine browser-side failure only (fetch rejected with a fetch-failure TypeError, or the browser is offline) | We couldn't connect. Check your internet connection and try again. |

Failures with no HTTP status and no clear cause (a thrown error that is not a failed
fetch) read: "We couldn't {verb} the {object}. Your changes haven't been saved. Try again in
a few minutes. If it keeps happening, contact your support team." (Loads drop the "changes"
sentence.) They never mention the internet connection: a TypeError from a bug in our own
code is not a network failure (UAT P3, see "Choosing the cause" below).

Load failures (`LoadErrorState`) use the same copy with a Retry action for everything
except 401 (Sign in) and 403 (`PermissionDenied`, "Access restricted", no retry).
On a 403 the "Access restricted" card (`PermissionDenied`, localised en/hi) shows the
standard 403 copy, or the specific domain-code copy when the service sent a known code
(self-approval, maker-checker). The service's free-text reason is never rendered (it can
carry role slugs and ownership detail); in development it is logged to the console.
Route error boundaries use the 5xx copy (or the network copy when offline) plus the
reference.

### Domain codes (win over status copy)

`DOMAIN_CODE_MESSAGES` in `errorCatalogue.ts`. Add a code there, in en and hi, when a
specific reason helps the user act:

| Code | Message |
| --- | --- |
| SELF_APPROVAL_FORBIDDEN, SELF_APPROVAL, SELF_APPROVAL_DENIED, FNF_SELF_APPROVAL_FORBIDDEN | You can't approve your own request. Another approver needs to do this. |
| MAKER_CHECKER, MAKER_CHECKER_VIOLATION | This needs approval from someone other than the person who made it. Another approver needs to do this. |
| STALE_ELECTION | This election was changed by someone else. Refresh to see the latest version, then choose again. |
| DESIGNATION_IN_USE | This can't be done while it's still in use elsewhere. Update or reassign whatever depends on it first, then try again. |
| DEPARTMENT_IN_USE | This department still has sub-departments or employees. Move or reassign them first, then try again. |
| DUPLICATE_CODE | This code is already in use. Choose a different code and try again. |
| GAZETTED_NOT_ELIGIBLE | Work from home isn't available at this employee's pay level. It is limited to the pay levels your office has made eligible. Ask HR if you think this is wrong. |
| WEEKLY_WFH_CAP_REACHED | These dates would go over the weekly work-from-home limit. Choose fewer days, or dates in a different week, and try again. |

A call site that has its own translated sentence for a code (for example
`postWithErrorCode`'s `codeMessages`) keeps using it; the central map is the fallback.

### Choosing the cause (UAT P3)

"Check your internet connection" may appear only for a genuine browser-side network
failure. The classification is:

| Situation | Kind | Where |
| --- | --- | --- |
| Loader (server-side fetchJson) got no HTTP status: gateway down, timeout, a mapper threw | server ("because of a problem on our side") | `loadFailureKind` in `lib/messages.ts`, used by `LoadErrorState` |
| Same, rendered in an online browser | unknown (honest, no connection blame) | `loadFailureKind` |
| The browser reports `navigator.onLine === false` | network | `loadFailureKind`, `RouteError`, `isNetworkFailure` |
| fetch rejected with a fetch-failure TypeError ("Failed to fetch", "NetworkError ...", "Load failed") | network | `isNetworkFailure` in `lib/userFacingError.ts` |
| Any other TypeError ("Cannot read properties of undefined") | unknown | `classifyThrown` |
| AbortError / TimeoutError, 408, 504 | timeout | `isTimeoutFailure`, `statusToKind` |

The journal-approvals screen showed "We couldn't connect. Check your internet connection"
while the browser of the officer was online: the server-side loader had no status and the old
rule read "no status" as "the request never reached us". `LoadErrorState` now asks
`loadFailureKind` first.

### Service error codes (serviceErrorCodes.ts)

After `DOMAIN_CODE_MESSAGES`, the resolver consults `src/lib/serviceErrorCodes.ts`:

1. `SERVICE_CODE_MESSAGES`: a hand-written en + hi message for one code (TASK_NOT_AUTHORIZED,
   SANCTION_REF_REQUIRED, BUDGET_EXCEEDED, ZERO_BASIC_SLIPS, NO_EMPLOYEE_RECORD,
   EMPLOYEE_NO_EXISTS, LAST_TENANT_ADMIN, ...).
2. `CODE_FAMILIES`: one en + hi message per naming family, first match wins:
   unknownReference (UNKNOWN_*), notFound (*_NOT_FOUND, status copy), separationOfDuties
   (SELF_*, SOD_*, MAKER_CHECKER*), permission (*_FORBIDDEN, NOT_ASSIGNEE, ...), duplicate
   (DUPLICATE_*, *_EXISTS, *_TAKEN), session, wait (cooldowns), conflict (STALE_*, *_CHANGED,
   status copy), inProgress, expired, virusScan, inactive, nothingToDo, limit, date, stage
   (INVALID_STATE, NOT_*, *_CLOSED, ...), setupMissing (NO_*), required (*_REQUIRED; with field
   errors the "highlighted fields" copy wins), timeout, upstream (server copy), mismatch,
   validation (status copy).

A caller-pinned situation (`forceKind`) still wins over a family; an explicit entry always
wins. `serviceErrorCodes.test.ts` scans `services/*` for every code thrown with
`HttpError(status, "CODE")`, `DomainError("CODE")` or `{ code: "CODE", message }` and fails
when a code matches neither an entry nor a family: add an entry, in en and hi.

### Thrown values

`messageForThrown(err, { kind, area })` in `lib/messages.ts` is the one way to turn a caught
value into words outside `useFormError`: a `UserFacingError` keeps its copy and reference; a
fetch failure or timeout gets its kind; a bare code (`no_drafts_imported`, `BUDGET_EXCEEDED`)
is looked up in the code map; a deliberate plain-language message is kept
(`isPresentableMessage`); anything else (stack text, a raw body, a status in brackets)
becomes the "cause unknown" copy. `useAsyncMutation` and `useConfirmAction` / `ActionButton`
use it.

## Message standard (12 rules, UAT P3)

A good message:

1. says WHAT happened, in plain words;
2. says WHY, if known, without blaming the user;
3. says WHAT TO DO NEXT, with a specific action or button;
4. never shows raw codes, stack traces, HTTP status numbers, snake_case keys or English-only
   technical words. A reference id for support is fine ("Reference: 7F3A...");
5. never names the wrong cause. "Check your internet connection" only for a genuine
   browser-side network failure, never for a server-side or loader error;
6. is specific to the object: "We couldn't load the journal approvals", not "Something went
   wrong";
7. uses one tone and the same terms as the screen labels;
8. has correct grammar and ICU plural forms: "1 joinee has overdue onboarding tasks",
   "4 leave requests could not be sent for approval" (`{count, plural, one {...} other {...}}`,
   never `request(s)` or a JSX `"s"` suffix);
9. keeps the data of the user, and says so ("What you entered is kept");
10. for permission errors, says which role is needed or whom to ask;
11. for validation errors, sits next to the field and says the rule ("Enter at least 10
    characters");
12. has a Hindi translation that matches the English in meaning, in natural administrative
    Hindi (as used in government offices: अनुमोदन, संस्वीकृति, शीर्ष, "पेज रीफ़्रेश करके फिर प्रयास करें"),
    not word-by-word, and is never left in English.

Standard next steps: loader badge or list: "Refresh the page to try again." /
"पेज रीफ़्रेश करके फिर प्रयास करें।"; in-page fetch or action: "Try again in a few minutes." /
"कुछ मिनट बाद फिर प्रयास करें।"; a partial load says what is still shown.

## Do / don't

| Don't | Do |
| --- | --- |
| Request failed (500) | We couldn't save the leave request because of a problem on our side. Your changes haven't been saved. Try again in a few minutes. |
| ALREADY_CLOSED: period is already hard-closed | (domain code with its own copy, or) This period was changed by someone else. Refresh to see the latest version, then try again. |
| Invalid input | Some details need changing. Check the highlighted fields and try again. |
| Oops! Something went wrong. | We couldn't load the payslips because of a problem on our side. Try again in a few minutes. |
| Error 403 Forbidden | You don't have permission to do this. Ask your administrator if you need access. |
| File too large. Maximum 5MB. | The file is too large. Upload a file smaller than 5 MB. |

## Throwing and rethrowing

- Never `throw new Error(await res.text())` (or `res.json()`): it puts the raw backend body
  on screen. The raw-status-leak guard flags it as NEW; there is no baseline for it. Use
  `throw await userFacingErrorFromResponse(res, "save", "leave request")`.
- If you resolve a message and rethrow it for a catch block to display, rethrow a
  `UserFacingError` (`throw UserFacingError.from(resolved)`), not a plain `Error`.
  `fromException(kind, caught)` treats a plain `Error` as "cause unknown", which tells the
  user to check their connection even though the server answered. Client-side validation
  messages thrown in the same try block are `UserFacingError` too.
- `browserFetch` / `browserJson` turn a dropped connection (raw `TypeError: Failed to fetch`)
  into a `UserFacingError` with the network copy, so `e.message` is always safe to render.
  A caller-initiated `AbortError` is left untouched.
- Do not render `err instanceof Error ? err.message : ...`; call `fromException(kind, err)`.

## Known follow-up

About 349 call sites still call the status-blind `toHumanError("load" | "save")` directly
(no HTTP status available there). Routing them through the resolver would change their
copy to the "cause unknown" wording, which blames the connection, and rewrite several
hundred tests, so it is left for a separate change that supplies a status at each site.

## Using it

```ts
// non-hook code (already the default inside errorMessageFromResponse / browserJson)
const msg = await errorMessageFromResponse(res, "save", "leave request");

// forms
const form = useFormError("leave request");
if (!res.ok) await form.fromResponse(res);        // fieldErrors + summary message + reference
// ...and in a catch block, ALWAYS pass the caught value:
catch (caught) { form.fromException("save", caught); }
//   UserFacingError (thrown by browserJson for a failed response) -> its status-aware message + reference
//   failed fetch (fetch-failure TypeError, or browser offline)   -> "We couldn't connect..."
//   AbortError / TimeoutError                                      -> "We couldn't ... in time" (timeout)
//   anything else / nothing passed                                 -> honest "cause unknown" copy (no connection blame)
// in JSX, top of the form (GOV.UK pattern):
<ErrorSummary error={form} fieldId={(f) => `leave-${f}`} />
```

Wording is localised in en and hi (the `locale` cookie). Hindi wording is a draft
pending native review. `src/lib/errorCatalogue.test.ts` enforces en/hi key and
placeholder parity and that no catalogued string contains a status number or banned term.
