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
| Network / timeout (408, 504, thrown fetch) | We couldn't connect. Check your internet connection and try again. |

Failures with no HTTP status and no clear cause (a thrown error that is not a failed
fetch) read: "We couldn't {verb} the {object}. Your changes haven't been saved. Check your
internet connection and try again in a few minutes." (Loads drop the "changes" sentence.)

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
| DUPLICATE_CODE | This code is already in use. Choose a different code and try again. |

A call site that has its own translated sentence for a code (for example
`postWithErrorCode`'s `codeMessages`) keeps using it; the central map is the fallback.

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
//   failed fetch (TypeError / AbortError / TimeoutError)          -> "We couldn't connect..."
//   anything else / nothing passed                                -> honest "cause unknown" copy
// in JSX, top of the form (GOV.UK pattern):
<ErrorSummary error={form} fieldId={(f) => `leave-${f}`} />
```

Wording is localised in en and hi (the `locale` cookie). Hindi wording is a draft
pending native review. `src/lib/errorCatalogue.test.ts` enforces en/hi key and
placeholder parity and that no catalogued string contains a status number or banned term.
