<#import "template.ftl" as layout>
<@layout.registrationLayout displayMessage=!messagesPerField.existsError('username','password') displayInfo=realm.password && realm.registrationAllowed; section>
    <#if section = "header">
        ${msg("loginAccountTitle")}
    <#elseif section = "form">
    <div id="kc-form">
      <div id="kc-form-wrapper">
        <#if realm.password>
            <form id="kc-form-login" onsubmit="login.disabled = true; return true;" action="${url.loginAction}" method="post">
                <div class="form-group">
                    <label for="username" class="pf-c-form__label"><span class="pf-c-form__label-text">${msg("usernameOrEmail")}</span></label>
                    <input tabindex="1" id="username" class="pf-c-form-control" name="username" value="${(login.username!'')}"  type="text" autofocus autocomplete="off"
                           aria-invalid="<#if messagesPerField.existsError('username','password')>true</#if>"
                    />
                    <#if messagesPerField.existsError('username','password')>
                        <span id="input-error" class="pf-c-form__helper-text pf-m-error" aria-live="polite">
                                ${kcSanitize(messagesPerField.getFirstError('username','password'))?no_esc}
                        </span>
                    </#if>
                </div>

                <div class="form-group">
                    <label for="password" class="pf-c-form__label"><span class="pf-c-form__label-text">${msg("password")}</span></label>
                    <div class="pf-c-input-group">
                        <input tabindex="2" id="password" class="pf-c-form-control" name="password" type="password" autocomplete="off"
                               aria-invalid="<#if messagesPerField.existsError('username','password')>true</#if>"
                        />
                        <button class="pf-c-button pf-m-control" type="button" aria-label="${msg('showPassword')}"
                            onclick="var p=document.getElementById('password');p.type=p.type==='password'?'text':'password';">
                            <i class="fa fa-eye" aria-hidden="true"></i>
                        </button>
                    </div>
                </div>

                <div class="form-group" id="kc-form-options">
                    <#if realm.rememberMe && !usernameHidden??>
                        <div class="checkbox">
                            <label>
                                <#if login.rememberMe??>
                                    <input tabindex="3" id="rememberMe" name="rememberMe" type="checkbox" checked> ${msg("rememberMe")}
                                <#else>
                                    <input tabindex="3" id="rememberMe" name="rememberMe" type="checkbox"> ${msg("rememberMe")}
                                </#if>
                            </label>
                        </div>
                    </#if>
                    <#if realm.resetPasswordAllowed>
                        <span><a tabindex="5" href="${url.loginResetCredentialsUrl}">${msg("doForgotPassword")}</a></span>
                    </#if>
                </div>

                <div id="kc-form-buttons" class="form-group">
                    <input type="hidden" id="id-hidden-input" name="credentialId" <#if auth.selectedCredential?has_content>value="${auth.selectedCredential}"</#if>/>
                    <input tabindex="4" class="pf-c-button pf-m-primary pf-m-block btn-lg" name="login" id="kc-login" type="submit" value="${msg("doLogIn")}"/>
                </div>
            </form>
        </#if>

        <div id="demo-credentials">
            <div class="demo-header">
                <span class="demo-badge">SANDBOX</span>
                <span class="demo-title">Test Accounts</span>
            </div>
            <div class="demo-accounts">
                <div class="demo-account">
                    <div class="demo-role">Super Admin</div>
                    <div class="demo-user">admin@civitasone.dev</div>
                </div>
                <div class="demo-account">
                    <div class="demo-role">HR Admin</div>
                    <div class="demo-user">priya</div>
                </div>
                <div class="demo-account">
                    <div class="demo-role">Employee</div>
                    <div class="demo-user">meera</div>
                </div>
            </div>
            <div class="demo-password">
                <span class="demo-pw-label">Password (all accounts):</span>
                <span class="demo-pw-value">Ask your team lead for the current sandbox password</span>
            </div>
        </div>
      </div>
    </div>
    </#if>
</@layout.registrationLayout>
