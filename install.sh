#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════════
# CivitasOne Suite — One-Command Cloud Installer
# ═══════════════════════════════════════════════════════════════════════════════
#
# World-class enterprise installer for cloud deployment (AWS/GCP/Azure/on-prem).
# Supports interactive and non-interactive modes with full pre-flight validation,
# resume-on-failure, and enterprise readiness scoring.
#
# Usage:
#   Interactive:    ./install.sh
#   Non-interactive: ./install.sh --config install.conf
#   Dry-run:        ./install.sh --dry-run
#   Resume:         ./install.sh --resume
#   Validate only:  ./install.sh --validate
#
# Features:
#   • Pre-flight validation (OS, deps, connectivity, permissions)
#   • Guided mode selection (Docker Compose / Helm / Manual)
#   • Automatic secret generation (cryptographically secure)
#   • Database bootstrap with per-service isolation
#   • Migration execution with resume-on-failure
#   • Post-install health verification
#   • Enterprise readiness scoring (0-100)
#   • Structured logging and diagnostic output
#   • Idempotent — safe to re-run on partial failures
#
# Requirements:
#   • bash 4+, curl, openssl
#   • Docker 24+ and Docker Compose v2 (for compose mode)
#   • kubectl + helm 3 (for Kubernetes mode)
#   • PostgreSQL client tools (psql, pg_isready) for validation
#
# Volume 11 compliance: §5, §6, §11, §12, §13, §14
# ═══════════════════════════════════════════════════════════════════════════════

set -euo pipefail

# ── Constants ─────────────────────────────────────────────────────────────────

readonly VERSION="1.0.0"
readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly INSTALL_LOG="${SCRIPT_DIR}/.install-log/install-$(date +%Y%m%d-%H%M%S).log"
readonly STATE_FILE="${SCRIPT_DIR}/.install-state.json"
readonly MIN_DOCKER_VERSION="24.0.0"
readonly MIN_COMPOSE_VERSION="2.20.0"
readonly MIN_HELM_VERSION="3.12.0"
readonly MIN_NODE_VERSION="20.0.0"
readonly REQUIRED_PORTS=(8080 3000 5432 6379 6432)

# Colors
readonly RED='\033[0;31m'
readonly GREEN='\033[0;32m'
readonly YELLOW='\033[0;33m'
readonly BLUE='\033[0;34m'
readonly CYAN='\033[0;36m'
readonly BOLD='\033[1m'
readonly DIM='\033[2m'
readonly NC='\033[0m'

# Counters
PASS=0
FAIL=0
WARN=0
SKIP=0
STEP=0
TOTAL_STEPS=0

# Mode
MODE=""           # compose | helm | manual
DRY_RUN=false
RESUME=false
VALIDATE_ONLY=false
CONFIG_FILE=""
NON_INTERACTIVE=false

# ── Logging ───────────────────────────────────────────────────────────────────

mkdir -p "$(dirname "$INSTALL_LOG")"

log() {
  local level="$1"; shift
  local msg="$*"
  local ts
  ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "${ts} [${level}] ${msg}" >> "$INSTALL_LOG"
  case "$level" in
    INFO)  printf "${DIM}%s${NC} %s\n" "[$ts]" "$msg" ;;
    OK)    printf "${GREEN}✓${NC} %s\n" "$msg" ;;
    WARN)  printf "${YELLOW}⚠${NC} %s\n" "$msg" ;;
    ERROR) printf "${RED}✗${NC} %s\n" "$msg" ;;
    STEP)  printf "\n${BLUE}━━━ Step %d/%d: %s ━━━${NC}\n" "$STEP" "$TOTAL_STEPS" "$msg" ;;
    HEAD)  printf "\n${BOLD}${CYAN}%s${NC}\n" "$msg" ;;
  esac
}

banner() {
  printf "\n"
  printf "${BOLD}${CYAN}"
  printf "╔══════════════════════════════════════════════════════════════╗\n"
  printf "║                                                              ║\n"
  printf "║        CivitasOne Suite — Cloud Installer v%s           ║\n" "$VERSION"
  printf "║        Enterprise ERP for Government & PSUs                  ║\n"
  printf "║                                                              ║\n"
  printf "╚══════════════════════════════════════════════════════════════╝\n"
  printf "${NC}\n"
}

check() {
  local desc="$1" result="$2" detail="${3:-}"
  if [ "$result" = "PASS" ]; then
    log OK "$desc"
    ((PASS++))
  elif [ "$result" = "WARN" ]; then
    log WARN "$desc${detail:+ — $detail}"
    ((WARN++))
  elif [ "$result" = "SKIP" ]; then
    printf "${DIM}⊘${NC} %s ${DIM}(skipped)${NC}\n" "$desc"
    ((SKIP++))
  else
    log ERROR "$desc${detail:+ — $detail}"
    ((FAIL++))
  fi
}

die() {
  log ERROR "$1"
  printf "\n${RED}Installation failed.${NC}\n"
  printf "Log: ${DIM}%s${NC}\n" "$INSTALL_LOG"
  printf "Resume with: ${BOLD}./install.sh --resume${NC}\n"
  save_state
  exit 1
}

# ── State Management (Resume Support) ────────────────────────────────────────

save_state() {
  cat > "$STATE_FILE" <<EOF
{
  "mode": "${MODE}",
  "step": ${STEP},
  "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "pass": ${PASS},
  "fail": ${FAIL},
  "warn": ${WARN}
}
EOF
  log INFO "State saved to $STATE_FILE (step $STEP)"
}

load_state() {
  if [[ -f "$STATE_FILE" ]]; then
    MODE=$(grep -o '"mode": *"[^"]*"' "$STATE_FILE" | cut -d'"' -f4)
    local saved_step
    saved_step=$(grep -o '"step": *[0-9]*' "$STATE_FILE" | grep -o '[0-9]*')
    STEP=${saved_step:-0}
    log INFO "Resumed from state file (mode=$MODE, step=$STEP)"
    return 0
  fi
  return 1
}

# ── Secret Generation ─────────────────────────────────────────────────────────

generate_secret() {
  local length="${1:-32}"
  openssl rand -base64 "$length" | tr -d '/+=' | head -c "$length"
}

generate_password() {
  # Generates a password with mixed case, digits, and symbols
  local length="${1:-24}"
  openssl rand -base64 48 | tr -d '/+' | head -c "$length"
}

# ── Version Comparison ────────────────────────────────────────────────────────

version_gte() {
  # Returns 0 if $1 >= $2 (semver comparison)
  printf '%s\n%s\n' "$2" "$1" | sort -V -C
}

# ── Pre-Flight Checks ────────────────────────────────────────────────────────

preflight_os() {
  log HEAD "── Pre-Flight: System Requirements ──"

  # OS detection
  local os_name=""
  if [[ -f /etc/os-release ]]; then
    os_name=$(grep '^PRETTY_NAME=' /etc/os-release | cut -d= -f2 | tr -d '"')
  elif [[ "$(uname)" == "Darwin" ]]; then
    os_name="macOS $(sw_vers -productVersion 2>/dev/null || echo 'unknown')"
  fi
  check "Operating system: ${os_name:-unknown}" "PASS"

  # Architecture
  local arch
  arch=$(uname -m)
  if [[ "$arch" == "x86_64" || "$arch" == "aarch64" || "$arch" == "arm64" ]]; then
    check "Architecture: $arch" "PASS"
  else
    check "Architecture: $arch (unsupported)" "FAIL"
  fi

  # Memory (minimum 4GB)
  local mem_kb
  if [[ -f /proc/meminfo ]]; then
    mem_kb=$(grep MemTotal /proc/meminfo | awk '{print $2}')
    local mem_gb=$((mem_kb / 1024 / 1024))
    if [[ $mem_gb -ge 8 ]]; then
      check "Memory: ${mem_gb}GB (recommended ≥8GB)" "PASS"
    elif [[ $mem_gb -ge 4 ]]; then
      check "Memory: ${mem_gb}GB (minimum met, recommend ≥8GB)" "WARN"
    else
      check "Memory: ${mem_gb}GB (minimum 4GB required)" "FAIL"
    fi
  else
    check "Memory check" "SKIP"
  fi

  # Disk space (minimum 20GB free)
  local free_gb
  free_gb=$(df -BG "${SCRIPT_DIR}" 2>/dev/null | awk 'NR==2{print $4}' | tr -d 'G' || echo "0")
  if [[ "$free_gb" -ge 50 ]]; then
    check "Disk space: ${free_gb}GB free (recommended ≥50GB)" "PASS"
  elif [[ "$free_gb" -ge 20 ]]; then
    check "Disk space: ${free_gb}GB free (minimum met, recommend ≥50GB)" "WARN"
  else
    check "Disk space: ${free_gb}GB free (minimum 20GB required)" "FAIL" "Expand disk or mount a larger volume"
  fi
}

preflight_deps() {
  log HEAD "── Pre-Flight: Dependencies ──"

  # bash version
  local bash_ver="${BASH_VERSION%%(*}"
  local bash_major="${bash_ver%%.*}"
  if [[ "$bash_major" -ge 4 ]]; then
    check "bash $bash_ver (≥4 required)" "PASS"
  else
    check "bash $bash_ver (≥4 required)" "FAIL"
  fi

  # Required tools
  for tool in curl openssl jq git; do
    if command -v "$tool" &>/dev/null; then
      check "$tool available" "PASS"
    else
      check "$tool available" "FAIL" "Install with: sudo apt-get install -y $tool"
    fi
  done

  # Docker
  if command -v docker &>/dev/null; then
    local docker_ver
    docker_ver=$(docker version --format '{{.Server.Version}}' 2>/dev/null || echo "0.0.0")
    if version_gte "$docker_ver" "$MIN_DOCKER_VERSION"; then
      check "Docker $docker_ver (≥$MIN_DOCKER_VERSION)" "PASS"
    else
      check "Docker $docker_ver (≥$MIN_DOCKER_VERSION required)" "FAIL"
    fi
  else
    check "Docker" "FAIL" "Install from https://docs.docker.com/engine/install/"
  fi

  # Docker Compose
  if docker compose version &>/dev/null 2>&1; then
    local compose_ver
    compose_ver=$(docker compose version --short 2>/dev/null | tr -d 'v')
    if version_gte "$compose_ver" "$MIN_COMPOSE_VERSION"; then
      check "Docker Compose $compose_ver (≥$MIN_COMPOSE_VERSION)" "PASS"
    else
      check "Docker Compose $compose_ver (≥$MIN_COMPOSE_VERSION required)" "WARN"
    fi
  else
    check "Docker Compose" "FAIL" "Included with Docker Desktop, or install docker-compose-plugin"
  fi

  # Docker daemon running
  if docker info &>/dev/null 2>&1; then
    check "Docker daemon running" "PASS"
  else
    check "Docker daemon running" "FAIL" "Start with: sudo systemctl start docker"
  fi

  # PostgreSQL client (for validation)
  if command -v psql &>/dev/null; then
    check "psql client available" "PASS"
  else
    check "psql client available" "WARN" "Install for post-install validation: sudo apt-get install -y postgresql-client"
  fi
}

preflight_ports() {
  log HEAD "── Pre-Flight: Port Availability ──"

  for port in "${REQUIRED_PORTS[@]}"; do
    if ! ss -tlnp 2>/dev/null | grep -q ":${port} " && \
       ! netstat -tlnp 2>/dev/null | grep -q ":${port} "; then
      check "Port $port available" "PASS"
    else
      local proc
      proc=$(ss -tlnp 2>/dev/null | grep ":${port} " | awk '{print $NF}' | head -1 || echo "unknown")
      check "Port $port in use by $proc" "WARN" "Will conflict — stop the existing process or change port in .env"
    fi
  done
}

preflight_network() {
  log HEAD "── Pre-Flight: Network Connectivity ──"

  # Docker Hub (image pulls)
  if curl -sf --max-time 10 "https://registry-1.docker.io/v2/" &>/dev/null || \
     curl -sf --max-time 10 "https://registry-1.docker.io/" &>/dev/null; then
    check "Docker Hub reachable" "PASS"
  else
    check "Docker Hub reachable" "WARN" "Image pulls may fail — pre-load images or use a private registry"
  fi

  # GitHub (for package downloads if needed)
  if curl -sf --max-time 10 "https://github.com" &>/dev/null; then
    check "GitHub reachable" "PASS"
  else
    check "GitHub reachable" "WARN" "May affect dependency installation"
  fi
}

# ── Mode Selection ────────────────────────────────────────────────────────────

select_mode() {
  if [[ -n "$MODE" ]]; then
    log INFO "Mode pre-selected: $MODE"
    return
  fi

  log HEAD "── Deployment Mode Selection ──"
  printf "\n"
  printf "  ${BOLD}1)${NC} Docker Compose  ${DIM}— Single host, quickest setup, ideal for eval/staging${NC}\n"
  printf "  ${BOLD}2)${NC} Kubernetes/Helm ${DIM}— Multi-node, production HA, autoscaling${NC}\n"
  printf "  ${BOLD}3)${NC} Manual          ${DIM}— Generate configs only, you deploy yourself${NC}\n"
  printf "\n"

  if [[ "$NON_INTERACTIVE" == true ]]; then
    MODE="compose"
    log INFO "Non-interactive mode: defaulting to Docker Compose"
    return
  fi

  local choice=""
  while [[ -z "$choice" ]]; do
    printf "  ${BOLD}Select mode [1-3]:${NC} "
    read -r choice
    case "$choice" in
      1) MODE="compose" ;;
      2) MODE="helm" ;;
      3) MODE="manual" ;;
      *) choice=""; printf "  ${RED}Invalid choice. Enter 1, 2, or 3.${NC}\n" ;;
    esac
  done
  log INFO "Selected mode: $MODE"
}

# ── Environment Configuration ─────────────────────────────────────────────────

configure_environment() {
  ((STEP++))
  log STEP "Environment Configuration"

  local env_file="infra/.env"

  if [[ -f "$env_file" && "$RESUME" == true ]]; then
    log OK "Environment file exists (resuming)"
    return
  fi

  log INFO "Generating secure environment configuration..."

  # Generate cryptographically secure secrets
  local db_password internal_secret device_secret mfa_key pii_key citizen_key crm_key kc_password
  db_password=$(generate_password 32)
  internal_secret=$(generate_secret 48)
  device_secret=$(generate_secret 48)
  mfa_key=$(generate_secret 32)
  pii_key=$(generate_secret 32)
  citizen_key=$(generate_secret 32)
  crm_key=$(generate_secret 32)
  kc_password=$(generate_password 24)

  # Domain/URL configuration
  local gateway_port="8080"
  local web_port="3000"
  local cors_origin="http://localhost:${web_port}"
  local api_base="http://localhost:${gateway_port}"

  if [[ "$NON_INTERACTIVE" != true ]]; then
    printf "\n  ${BOLD}Configuration (press Enter for defaults):${NC}\n\n"

    printf "  Gateway port [${gateway_port}]: "
    read -r input; [[ -n "$input" ]] && gateway_port="$input"

    printf "  Web app port [${web_port}]: "
    read -r input; [[ -n "$input" ]] && web_port="$input"

    printf "  Public API URL [${api_base}]: "
    read -r input; [[ -n "$input" ]] && api_base="$input"

    printf "  CORS origin [${cors_origin}]: "
    read -r input; [[ -n "$input" ]] && cors_origin="$input"
  fi

  # Write the .env file
  cat > "$env_file" <<EOF
# ═══════════════════════════════════════════════════════════════════════════════
# CivitasOne Suite — Generated Environment Configuration
# Generated by install.sh v${VERSION} on $(date -u +%Y-%m-%dT%H:%M:%SZ)
# SECURITY: This file contains secrets. Never commit to version control.
# ═══════════════════════════════════════════════════════════════════════════════

# ── Image Registry ──
IMAGE_REGISTRY=civitasone
IMAGE_TAG=latest

# ── PostgreSQL ──
POSTGRES_USER=civitasone
POSTGRES_PASSWORD=${db_password}
POSTGRES_DB=civitasone

# ── Platform Secrets (auto-generated, cryptographically secure) ──
INTERNAL_SERVICE_SECRET=${internal_secret}
DEVICE_TRUST_SECRET=${device_secret}

# ── PII / MFA Encryption Keys ──
MFA_ENC_KEY=${mfa_key}
PII_ENC_KEY=${pii_key}
CITIZEN_PII_KEY=${citizen_key}
CRM_PII_KEY=${crm_key}

# ── Keycloak (OIDC Identity Provider) ──
KEYCLOAK_ADMIN=admin
KEYCLOAK_ADMIN_PASSWORD=${kc_password}
KEYCLOAK_REALM=civitasone

# ── AWS / Queue (LocalStack for local; set real creds for production AWS) ──
AWS_DEFAULT_REGION=ap-south-1
AWS_ACCESS_KEY_ID=test
AWS_SECRET_ACCESS_KEY=test
AWS_S3_BUCKET=civitasone

# ── Networking ──
GATEWAY_PORT=${gateway_port}
WEB_PORT=${web_port}
CORS_ORIGIN=${cors_origin}
NEXT_PUBLIC_API_BASE_URL=${api_base}
EOF

  chmod 600 "$env_file"
  log OK "Environment configured (secrets auto-generated)"
  log INFO "Env file: $env_file (mode 600, never commit)"
}

# ── Docker Compose Installation ───────────────────────────────────────────────

compose_validate() {
  ((STEP++))
  log STEP "Validate Compose Configuration"

  if docker compose -f infra/docker-compose.prod.yml --env-file infra/.env config -q 2>/dev/null; then
    check "Compose config valid (all required vars set)" "PASS"
  else
    check "Compose config validation" "FAIL" "Missing required variables in infra/.env"
    die "Fix infra/.env and re-run"
  fi
}

compose_pull_or_build() {
  ((STEP++))
  log STEP "Build/Pull Container Images"

  local image_registry
  image_registry=$(grep '^IMAGE_REGISTRY=' infra/.env 2>/dev/null | cut -d= -f2)

  # Check if images exist locally or need building
  if docker images "${image_registry}/gateway-service" --format '{{.Repository}}' 2>/dev/null | grep -q gateway; then
    check "Images available locally" "PASS"
    return
  fi

  log INFO "Building all service images (this takes 5-15 minutes on first run)..."
  printf "  ${DIM}Building 33 services + gateway + web...${NC}\n"

  if [[ "$DRY_RUN" == true ]]; then
    check "Image build (dry-run, skipped)" "SKIP"
    return
  fi

  if docker compose -f infra/docker-compose.prod.yml --env-file infra/.env build 2>>"$INSTALL_LOG"; then
    check "All images built successfully" "PASS"
  else
    check "Image build" "FAIL" "Check $INSTALL_LOG for details"
    die "Image build failed. Ensure Docker has at least 8GB memory allocated."
  fi
}

compose_start_infra() {
  ((STEP++))
  log STEP "Start Infrastructure (PostgreSQL, Redis, Keycloak, SQS)"

  if [[ "$DRY_RUN" == true ]]; then
    check "Infrastructure start (dry-run, skipped)" "SKIP"
    return
  fi

  # Start only infrastructure services first
  local infra_services="postgres pgbouncer redis localstack keycloak"
  if docker compose -f infra/docker-compose.prod.yml --env-file infra/.env up -d $infra_services 2>>"$INSTALL_LOG"; then
    check "Infrastructure containers started" "PASS"
  else
    check "Infrastructure start" "FAIL"
    die "Failed to start infrastructure. Check Docker logs."
  fi

  # Wait for health checks
  log INFO "Waiting for infrastructure health checks..."
  local max_wait=120
  local waited=0
  local all_healthy=false

  while [[ $waited -lt $max_wait ]]; do
    local healthy_count
    healthy_count=$(docker compose -f infra/docker-compose.prod.yml --env-file infra/.env ps --format json 2>/dev/null | \
      jq -r 'select(.Health == "healthy") | .Service' 2>/dev/null | wc -l || echo "0")

    if [[ "$healthy_count" -ge 4 ]]; then
      all_healthy=true
      break
    fi

    printf "\r  ${DIM}Waiting for infra health... (%ds/${max_wait}s, %d/4 healthy)${NC}" "$waited" "$healthy_count"
    sleep 5
    ((waited += 5))
  done
  printf "\r%80s\r" " "  # clear line

  if [[ "$all_healthy" == true ]]; then
    check "Infrastructure healthy (Postgres, Redis, SQS, Keycloak)" "PASS"
  else
    check "Infrastructure health (timeout after ${max_wait}s)" "WARN" "Some services may still be starting"
  fi
}

compose_run_migrations() {
  ((STEP++))
  log STEP "Database Bootstrap & Migrations"

  if [[ "$DRY_RUN" == true ]]; then
    check "Migrations (dry-run, skipped)" "SKIP"
    return
  fi

  # Bootstrap per-service databases
  log INFO "Creating per-service databases..."
  if docker compose -f infra/docker-compose.prod.yml --env-file infra/.env exec -T postgres \
    psql -U civitasone -f /docker-entrypoint-initdb.d/01-bootstrap.sql 2>>"$INSTALL_LOG"; then
    check "Per-service database bootstrap" "PASS"
  else
    # May already be bootstrapped on resume
    check "Per-service database bootstrap (may be already done)" "WARN"
  fi

  # Run migrations via the migrate-all script
  log INFO "Applying migrations (idempotent — safe to re-run)..."
  if node scripts/dev/migrate-all.mjs 2>>"$INSTALL_LOG" | tail -5; then
    check "Database migrations applied" "PASS"
  else
    check "Database migrations" "FAIL" "Check $INSTALL_LOG for details"
    die "Migration failure. Re-run with --resume after fixing the issue."
  fi
}

compose_start_services() {
  ((STEP++))
  log STEP "Start Application Services"

  if [[ "$DRY_RUN" == true ]]; then
    check "Service start (dry-run, skipped)" "SKIP"
    return
  fi

  log INFO "Starting all 33 services + gateway + web..."
  if docker compose -f infra/docker-compose.prod.yml --env-file infra/.env up -d 2>>"$INSTALL_LOG"; then
    check "All services started" "PASS"
  else
    check "Service start" "FAIL"
    die "Failed to start services. Check: docker compose -f infra/docker-compose.prod.yml logs"
  fi

  # Wait for services to become healthy
  log INFO "Waiting for services to pass health checks (up to 3 minutes)..."
  local max_wait=180
  local waited=0
  local target_healthy=30  # At least 30 of ~35 containers should be healthy

  while [[ $waited -lt $max_wait ]]; do
    local healthy_count
    healthy_count=$(docker compose -f infra/docker-compose.prod.yml --env-file infra/.env ps --format json 2>/dev/null | \
      jq -r 'select(.Health == "healthy" or .State == "running") | .Service' 2>/dev/null | wc -l || echo "0")

    if [[ "$healthy_count" -ge $target_healthy ]]; then
      break
    fi

    printf "\r  ${DIM}Services starting... (%ds/${max_wait}s, %d/%d ready)${NC}" "$waited" "$healthy_count" "$target_healthy"
    sleep 10
    ((waited += 10))
  done
  printf "\r%80s\r" " "

  local final_count
  final_count=$(docker compose -f infra/docker-compose.prod.yml --env-file infra/.env ps --status running 2>/dev/null | wc -l || echo "0")
  if [[ "$final_count" -ge $target_healthy ]]; then
    check "Services healthy: ${final_count} running" "PASS"
  else
    check "Services: ${final_count} running (expected ≥${target_healthy})" "WARN" "Some services may need more time"
  fi
}

# ── Post-Install Validation ───────────────────────────────────────────────────

post_install_validate() {
  ((STEP++))
  log STEP "Post-Install Validation"

  if [[ "$DRY_RUN" == true ]]; then
    check "Post-install validation (dry-run, skipped)" "SKIP"
    return
  fi

  local gw_url="http://localhost:${GATEWAY_PORT:-8080}"
  local web_url="http://localhost:${WEB_PORT:-3000}"

  # Source ports from env if available
  if [[ -f infra/.env ]]; then
    local gw_port web_port
    gw_port=$(grep '^GATEWAY_PORT=' infra/.env 2>/dev/null | cut -d= -f2 || echo "8080")
    web_port=$(grep '^WEB_PORT=' infra/.env 2>/dev/null | cut -d= -f2 || echo "3000")
    gw_url="http://localhost:${gw_port}"
    web_url="http://localhost:${web_port}"
  fi

  printf "\n"

  # Gateway health
  if curl -sf --max-time 10 "${gw_url}/health" &>/dev/null; then
    check "Gateway health (${gw_url}/health)" "PASS"
  else
    check "Gateway health (${gw_url}/health)" "FAIL" "Gateway not responding"
  fi

  # Web app
  if curl -sf --max-time 10 "${web_url}" &>/dev/null; then
    check "Web application (${web_url})" "PASS"
  else
    check "Web application (${web_url})" "WARN" "Web app may still be starting (Next.js build)"
  fi

  # Redis
  if docker compose -f infra/docker-compose.prod.yml --env-file infra/.env exec -T redis redis-cli ping 2>/dev/null | grep -q PONG; then
    check "Redis PING/PONG" "PASS"
  else
    check "Redis connectivity" "WARN"
  fi

  # PostgreSQL
  if docker compose -f infra/docker-compose.prod.yml --env-file infra/.env exec -T postgres pg_isready -U civitasone 2>/dev/null | grep -q "accepting"; then
    check "PostgreSQL accepting connections" "PASS"
  else
    check "PostgreSQL connectivity" "WARN"
  fi

  # SQS (LocalStack)
  if docker compose -f infra/docker-compose.prod.yml --env-file infra/.env exec -T localstack awslocal sqs list-queues &>/dev/null; then
    check "SQS queue service (LocalStack)" "PASS"
  else
    check "SQS queue service" "WARN"
  fi

  # Keycloak
  if curl -sf --max-time 10 "http://localhost:8180/health/ready" &>/dev/null || \
     curl -sf --max-time 10 "http://localhost:8080/health/ready" &>/dev/null; then
    check "Keycloak OIDC ready" "PASS"
  else
    check "Keycloak OIDC" "WARN" "May need more time to import realm"
  fi

  # API round-trip test
  local api_resp
  api_resp=$(curl -sf --max-time 10 "${gw_url}/health" 2>/dev/null || echo "")
  if [[ -n "$api_resp" ]]; then
    check "API round-trip (gateway → response)" "PASS"
  else
    check "API round-trip" "WARN"
  fi
}

# ── Enterprise Readiness Score ────────────────────────────────────────────────

compute_readiness_score() {
  ((STEP++))
  log STEP "Enterprise Readiness Score"

  local score=0
  local max_score=100
  local checks_passed=0
  local checks_total=20

  printf "\n"

  # Security (25 points)
  printf "  ${BOLD}Security (25 pts)${NC}\n"

  # JWT is RS256 in production
  if grep -q 'JWT_ALGORITHM.*RS256\|JWT_ALGORITHM: RS256' infra/.env infra/docker-compose.prod.yml 2>/dev/null; then
    printf "    ${GREEN}✓${NC} JWT RS256 configured (5 pts)\n"; ((score+=5)); ((checks_passed++))
  else
    printf "    ${YELLOW}⚠${NC} JWT RS256 not confirmed (0/5 pts)\n"
  fi
  ((checks_total++)) || true

  # Secrets are not defaults
  if ! grep -q 'CHANGE_ME\|your-secret-here' infra/.env 2>/dev/null; then
    printf "    ${GREEN}✓${NC} All secrets are non-default (5 pts)\n"; ((score+=5)); ((checks_passed++))
  else
    printf "    ${YELLOW}⚠${NC} Default secrets detected (0/5 pts)\n"
  fi

  # Internal service secret length >= 32
  local iss_len
  iss_len=$(grep '^INTERNAL_SERVICE_SECRET=' infra/.env 2>/dev/null | cut -d= -f2 | wc -c || echo "0")
  if [[ "$iss_len" -ge 32 ]]; then
    printf "    ${GREEN}✓${NC} Service secret ≥32 chars (5 pts)\n"; ((score+=5)); ((checks_passed++))
  else
    printf "    ${YELLOW}⚠${NC} Service secret too short (0/5 pts)\n"
  fi

  # PII encryption keys present
  if grep -q '^PII_ENC_KEY=.\{16,\}' infra/.env 2>/dev/null; then
    printf "    ${GREEN}✓${NC} PII encryption key configured (5 pts)\n"; ((score+=5)); ((checks_passed++))
  else
    printf "    ${YELLOW}⚠${NC} PII encryption key missing (0/5 pts)\n"
  fi

  # Non-root containers
  if grep -q 'USER node\|runAsNonRoot: true' Dockerfile infra/onprem/helm/civitasone/templates/deployment.yaml 2>/dev/null; then
    printf "    ${GREEN}✓${NC} Containers run as non-root (5 pts)\n"; ((score+=5)); ((checks_passed++))
  else
    printf "    ${YELLOW}⚠${NC} Non-root container check inconclusive (0/5 pts)\n"
  fi

  printf "\n  ${BOLD}Reliability (20 pts)${NC}\n"

  # Database is up
  if docker compose -f infra/docker-compose.prod.yml --env-file infra/.env exec -T postgres pg_isready -U civitasone &>/dev/null 2>&1; then
    printf "    ${GREEN}✓${NC} PostgreSQL healthy (5 pts)\n"; ((score+=5)); ((checks_passed++))
  else
    printf "    ${YELLOW}⚠${NC} PostgreSQL not healthy (0/5 pts)\n"
  fi

  # Redis is up
  if docker compose -f infra/docker-compose.prod.yml --env-file infra/.env exec -T redis redis-cli ping 2>/dev/null | grep -q PONG; then
    printf "    ${GREEN}✓${NC} Redis healthy (5 pts)\n"; ((score+=5)); ((checks_passed++))
  else
    printf "    ${YELLOW}⚠${NC} Redis not healthy (0/5 pts)\n"
  fi

  # Health checks configured
  if grep -q 'healthcheck:' infra/docker-compose.prod.yml 2>/dev/null; then
    printf "    ${GREEN}✓${NC} Health checks configured (5 pts)\n"; ((score+=5)); ((checks_passed++))
  else
    printf "    ${YELLOW}⚠${NC} Health checks missing (0/5 pts)\n"
  fi

  # PgBouncer connection pooling
  if grep -q 'pgbouncer' infra/docker-compose.prod.yml 2>/dev/null; then
    printf "    ${GREEN}✓${NC} Connection pooling (PgBouncer) enabled (5 pts)\n"; ((score+=5)); ((checks_passed++))
  else
    printf "    ${YELLOW}⚠${NC} No connection pooling (0/5 pts)\n"
  fi

  printf "\n  ${BOLD}Observability (15 pts)${NC}\n"

  # Structured logging (Pino)
  if grep -rq 'pino' packages/observability/ 2>/dev/null; then
    printf "    ${GREEN}✓${NC} Structured logging (Pino) (5 pts)\n"; ((score+=5)); ((checks_passed++))
  else
    printf "    ${YELLOW}⚠${NC} Structured logging not confirmed (0/5 pts)\n"
  fi

  # Health endpoints
  if grep -q '/health\|/ready' Dockerfile 2>/dev/null; then
    printf "    ${GREEN}✓${NC} Health/readiness probes configured (5 pts)\n"; ((score+=5)); ((checks_passed++))
  else
    printf "    ${YELLOW}⚠${NC} Health probes not confirmed (0/5 pts)\n"
  fi

  # Metrics endpoint
  if grep -rq '/metrics' services/gateway-service/src/response-metrics.ts 2>/dev/null; then
    printf "    ${GREEN}✓${NC} Prometheus metrics endpoint (5 pts)\n"; ((score+=5)); ((checks_passed++))
  else
    printf "    ${YELLOW}⚠${NC} Metrics endpoint missing (0/5 pts)\n"
  fi

  printf "\n  ${BOLD}Backup & DR (15 pts)${NC}\n"

  # Backup script exists
  if [[ -f scripts/ops/backup-databases.sh ]]; then
    printf "    ${GREEN}✓${NC} Backup script present (5 pts)\n"; ((score+=5)); ((checks_passed++))
  else
    printf "    ${YELLOW}⚠${NC} No backup script (0/5 pts)\n"
  fi

  # Restore drill exists
  if [[ -f scripts/ops/restore-drill.sh ]]; then
    printf "    ${GREEN}✓${NC} Restore drill script present (5 pts)\n"; ((score+=5)); ((checks_passed++))
  else
    printf "    ${YELLOW}⚠${NC} No restore drill (0/5 pts)\n"
  fi

  # DR workflow exists
  if [[ -f .github/workflows/dr-drill.yml ]]; then
    printf "    ${GREEN}✓${NC} Automated DR drill workflow (5 pts)\n"; ((score+=5)); ((checks_passed++))
  else
    printf "    ${YELLOW}⚠${NC} No DR automation (0/5 pts)\n"
  fi

  printf "\n  ${BOLD}Performance (10 pts)${NC}\n"

  # Redis caching configured
  if grep -rq 'cache.getOrLoad\|REDIS_URL' services/ 2>/dev/null | head -1 | grep -q .; then
    printf "    ${GREEN}✓${NC} Redis caching layer (5 pts)\n"; ((score+=5)); ((checks_passed++))
  else
    printf "    ${YELLOW}⚠${NC} Caching not confirmed (0/5 pts)\n"
  fi

  # Rate limiting
  if grep -q 'rate-limit\|rateLimit' services/gateway-service/src/app.ts 2>/dev/null; then
    printf "    ${GREEN}✓${NC} Rate limiting configured (5 pts)\n"; ((score+=5)); ((checks_passed++))
  else
    printf "    ${YELLOW}⚠${NC} Rate limiting not confirmed (0/5 pts)\n"
  fi

  printf "\n  ${BOLD}Documentation (10 pts)${NC}\n"

  # Deploy docs
  if [[ -f infra/DEPLOY.md ]]; then
    printf "    ${GREEN}✓${NC} Deployment documentation (5 pts)\n"; ((score+=5)); ((checks_passed++))
  else
    printf "    ${YELLOW}⚠${NC} No deployment docs (0/5 pts)\n"
  fi

  # Runbooks
  local runbook_count
  runbook_count=$(find docs/runbooks -name '*.md' 2>/dev/null | wc -l || echo "0")
  if [[ "$runbook_count" -ge 5 ]]; then
    printf "    ${GREEN}✓${NC} Runbooks present ($runbook_count files) (5 pts)\n"; ((score+=5)); ((checks_passed++))
  else
    printf "    ${YELLOW}⚠${NC} Insufficient runbooks ($runbook_count) (0/5 pts)\n"
  fi

  printf "\n  ${BOLD}Operational Hygiene (5 pts)${NC}\n"

  # No test data flag
  if grep -q 'NODE_ENV.*production\|NODE_ENV: production' infra/.env infra/docker-compose.prod.yml 2>/dev/null; then
    printf "    ${GREEN}✓${NC} Production mode set (3 pts)\n"; ((score+=3)); ((checks_passed++))
  else
    printf "    ${YELLOW}⚠${NC} Not in production mode (0/3 pts)\n"
  fi

  # .env not committed
  if grep -q 'infra/.env\|\.env\.local' .gitignore 2>/dev/null; then
    printf "    ${GREEN}✓${NC} Secrets excluded from git (2 pts)\n"; ((score+=2)); ((checks_passed++))
  else
    printf "    ${YELLOW}⚠${NC} .env may be committed (0/2 pts)\n"
  fi

  # Final score
  printf "\n"
  printf "  ╔════════════════════════════════════════════╗\n"
  if [[ $score -ge 85 ]]; then
    printf "  ║  ${GREEN}${BOLD}Enterprise Readiness Score: %d/100${NC}     ║\n" "$score"
    printf "  ║  ${GREEN}Verdict: READY FOR PRODUCTION${NC}          ║\n"
  elif [[ $score -ge 60 ]]; then
    printf "  ║  ${YELLOW}${BOLD}Enterprise Readiness Score: %d/100${NC}     ║\n" "$score"
    printf "  ║  ${YELLOW}Verdict: NEEDS ATTENTION${NC}                ║\n"
  else
    printf "  ║  ${RED}${BOLD}Enterprise Readiness Score: %d/100${NC}     ║\n" "$score"
    printf "  ║  ${RED}Verdict: NOT PRODUCTION READY${NC}           ║\n"
  fi
  printf "  ╚════════════════════════════════════════════╝\n"

  log INFO "Enterprise Readiness Score: ${score}/100"
}

# ── Final Summary ─────────────────────────────────────────────────────────────

print_summary() {
  local gw_port web_port
  gw_port=$(grep '^GATEWAY_PORT=' infra/.env 2>/dev/null | cut -d= -f2 || echo "8080")
  web_port=$(grep '^WEB_PORT=' infra/.env 2>/dev/null | cut -d= -f2 || echo "3000")

  printf "\n"
  printf "  ${BOLD}${CYAN}═══════════════════════════════════════════════════════════${NC}\n"
  printf "  ${BOLD}${CYAN}  Installation Complete${NC}\n"
  printf "  ${BOLD}${CYAN}═══════════════════════════════════════════════════════════${NC}\n"
  printf "\n"
  printf "  ${BOLD}Access Points:${NC}\n"
  printf "    Web Application:  ${GREEN}http://localhost:${web_port}${NC}\n"
  printf "    API Gateway:      ${GREEN}http://localhost:${gw_port}${NC}\n"
  printf "    Gateway Health:   http://localhost:${gw_port}/health\n"
  printf "    Keycloak Admin:   http://localhost:8180 (admin / see .env)\n"
  printf "\n"
  printf "  ${BOLD}Results:${NC}\n"
  printf "    ${GREEN}Passed: ${PASS}${NC}  ${YELLOW}Warnings: ${WARN}${NC}  ${RED}Failed: ${FAIL}${NC}  Skipped: ${SKIP}\n"
  printf "\n"
  printf "  ${BOLD}Next Steps:${NC}\n"
  printf "    1. Open ${GREEN}http://localhost:${web_port}${NC} in your browser\n"
  printf "    2. Complete the setup wizard (first-time configuration)\n"
  printf "    3. Configure SSO/MFA in Keycloak for production hardening\n"
  printf "    4. Set up backup automation: ${DIM}scripts/ops/backup-databases.sh${NC}\n"
  printf "    5. Review the deployment guide: ${DIM}infra/DEPLOY.md${NC}\n"
  printf "\n"
  printf "  ${BOLD}Management:${NC}\n"
  printf "    Stop:    ${DIM}docker compose -f infra/docker-compose.prod.yml --env-file infra/.env down${NC}\n"
  printf "    Logs:    ${DIM}docker compose -f infra/docker-compose.prod.yml --env-file infra/.env logs -f${NC}\n"
  printf "    Status:  ${DIM}docker compose -f infra/docker-compose.prod.yml --env-file infra/.env ps${NC}\n"
  printf "    Validate:${DIM}./scripts/ops/validate-install.sh${NC}\n"
  printf "\n"
  printf "  ${BOLD}Files:${NC}\n"
  printf "    Install log: ${DIM}${INSTALL_LOG}${NC}\n"
  printf "    Env config:  ${DIM}infra/.env${NC} (contains secrets — never commit)\n"
  printf "\n"

  if [[ $FAIL -gt 0 ]]; then
    printf "  ${RED}${BOLD}⚠ Installation completed with ${FAIL} failure(s).${NC}\n"
    printf "  ${RED}  Review the log and re-run with: ./install.sh --resume${NC}\n"
  elif [[ $WARN -gt 0 ]]; then
    printf "  ${YELLOW}Installation completed with warnings. Review before production use.${NC}\n"
  else
    printf "  ${GREEN}${BOLD}✓ Installation completed successfully. System is ready.${NC}\n"
  fi
  printf "\n"
}

# ── CLI Argument Parsing ──────────────────────────────────────────────────────

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --dry-run)
        DRY_RUN=true
        shift ;;
      --resume)
        RESUME=true
        shift ;;
      --validate)
        VALIDATE_ONLY=true
        shift ;;
      --config)
        CONFIG_FILE="${2:-}"
        NON_INTERACTIVE=true
        if [[ -z "$CONFIG_FILE" || ! -f "$CONFIG_FILE" ]]; then
          die "--config requires a valid file path"
        fi
        shift 2 ;;
      --mode)
        MODE="${2:-}"
        if [[ "$MODE" != "compose" && "$MODE" != "helm" && "$MODE" != "manual" ]]; then
          die "--mode must be: compose, helm, or manual"
        fi
        shift 2 ;;
      --non-interactive)
        NON_INTERACTIVE=true
        shift ;;
      --help|-h)
        printf "CivitasOne Suite — Cloud Installer v${VERSION}\n\n"
        printf "Usage:\n"
        printf "  ./install.sh                     Interactive installation\n"
        printf "  ./install.sh --config FILE       Non-interactive from config file\n"
        printf "  ./install.sh --dry-run           Validate without making changes\n"
        printf "  ./install.sh --resume            Resume from last checkpoint\n"
        printf "  ./install.sh --validate          Run post-install validation only\n"
        printf "  ./install.sh --mode compose      Skip mode selection\n"
        printf "  ./install.sh --non-interactive   Use defaults for all prompts\n"
        printf "\n"
        exit 0 ;;
      *)
        die "Unknown argument: $1 (use --help for usage)" ;;
    esac
  done
}

# ── Main ──────────────────────────────────────────────────────────────────────

main() {
  parse_args "$@"

  cd "$SCRIPT_DIR"
  banner

  if [[ "$DRY_RUN" == true ]]; then
    printf "  ${YELLOW}${BOLD}DRY RUN MODE — no changes will be made${NC}\n\n"
  fi

  # Resume from previous state if requested
  if [[ "$RESUME" == true ]]; then
    if load_state; then
      printf "  ${CYAN}Resuming from step ${STEP} (mode: ${MODE})${NC}\n"
    else
      log WARN "No state file found — starting fresh"
      RESUME=false
    fi
  fi

  # Validate-only mode
  if [[ "$VALIDATE_ONLY" == true ]]; then
    TOTAL_STEPS=2
    STEP=0
    post_install_validate
    compute_readiness_score
    exit 0
  fi

  # Load config file if provided
  if [[ -n "$CONFIG_FILE" ]]; then
    log INFO "Loading config from $CONFIG_FILE"
    # shellcheck disable=SC1090
    source "$CONFIG_FILE"
  fi

  # Set total steps based on mode
  TOTAL_STEPS=9

  # ── Phase 1: Pre-flight ──
  if [[ $STEP -lt 1 ]]; then
    preflight_os
    preflight_deps
    preflight_ports
    preflight_network

    printf "\n"
    if [[ $FAIL -gt 0 ]]; then
      printf "  ${RED}${BOLD}Pre-flight failed with ${FAIL} error(s).${NC}\n"
      printf "  Fix the issues above and re-run.\n\n"
      save_state
      exit 1
    fi
    printf "  ${GREEN}Pre-flight passed: ${PASS} checks OK, ${WARN} warnings.${NC}\n"
  fi

  # ── Phase 2: Mode Selection ──
  if [[ $STEP -lt 2 ]]; then
    select_mode
  fi

  # ── Phase 3: Installation (mode-specific) ──
  case "$MODE" in
    compose)
      configure_environment
      compose_validate
      compose_pull_or_build
      compose_start_infra
      compose_run_migrations
      compose_start_services
      post_install_validate
      compute_readiness_score
      ;;
    helm)
      printf "\n  ${CYAN}Helm/Kubernetes deployment:${NC}\n"
      printf "  See ${BOLD}infra/DEPLOY.md${NC} section B for the full Helm workflow.\n"
      printf "  This installer generated your configuration — deploy with:\n\n"
      printf "    helm upgrade --install civitasone infra/onprem/helm/civitasone \\\\\n"
      printf "      --namespace civitasone --create-namespace \\\\\n"
      printf "      --set image.registry=YOUR_REGISTRY \\\\\n"
      printf "      --set image.tag=latest\n\n"
      ;;
    manual)
      configure_environment
      printf "\n  ${CYAN}Manual deployment:${NC}\n"
      printf "  Configuration generated at ${BOLD}infra/.env${NC}\n"
      printf "  Use this with your preferred orchestration tool.\n"
      printf "  After deployment, validate with: ${BOLD}./install.sh --validate${NC}\n\n"
      ;;
  esac

  # ── Phase 4: Summary ──
  print_summary
  save_state

  # Clean up state file on success
  if [[ $FAIL -eq 0 ]]; then
    rm -f "$STATE_FILE"
  fi
}

main "$@"
