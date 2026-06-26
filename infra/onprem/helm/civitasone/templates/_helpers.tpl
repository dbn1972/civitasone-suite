{{/* Common helpers for the CivitasOne chart */}}

{{- define "civitasone.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "civitasone.fullname" -}}
{{- printf "%s-%s" .Release.Name (include "civitasone.name" .) | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "civitasone.labels" -}}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/part-of: civitasone
{{- end -}}

{{- define "civitasone.serviceAccountName" -}}
{{- if .Values.serviceAccount.create -}}
{{- default (printf "%s-civitasone" .Release.Name) .Values.serviceAccount.name -}}
{{- else -}}
{{- default "default" .Values.serviceAccount.name -}}
{{- end -}}
{{- end -}}

{{/* Image registry prefix: global override > image.registry */}}
{{- define "civitasone.imagePrefix" -}}
{{- if .Values.global.imageRegistry -}}
{{- printf "%s/%s" (trimSuffix "/" .Values.global.imageRegistry) .Values.image.registry -}}
{{- else -}}
{{- .Values.image.registry -}}
{{- end -}}
{{- end -}}

{{/*
Shared env block. Args: dict "root" $ "svc" <name> "cfg" <serviceCfg>
Renders: ConfigMap envFrom values + PORT + DATABASE_URL + secret env keys.
*/}}
{{- define "civitasone.envFrom" -}}
- configMapRef:
    name: {{ .Release.Name }}-civitasone-config
{{- end -}}

{{- define "civitasone.selectorLabels" -}}
app.kubernetes.io/part-of: civitasone
{{- end -}}
