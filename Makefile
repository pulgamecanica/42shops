# 42 Shops. Run `make` to list targets.

# Release name, bumped by hand for each release. The GitHub release workflow
# reads it from here (`make codename`) and tags v<package.json version>.
CODENAME := Moulinette

VERSION  := $(shell node -p "require('./package.json').version")
ENV_FILE ?= $(if $(wildcard .env.local),.env.local,.env)
ENV      := ENV_FILE=$(ENV_FILE) node scripts/env.mjs

# Docker and deploys. HOST is an ssh target (user@server or a ~/.ssh/config alias).
IMAGE      ?= ghcr.io/pulgamecanica/42shops
TAG        ?= v$(VERSION)
PROD_ENV   ?= .env.production
HOST       ?=
DEPLOY_DIR ?= /opt/42shops
PORT       ?= 3000
# docker-up/deploy save TAG, PROD_ENV and PORT in .deploy.env, so every later
# compose call (restarts from secret-rotate, logs, down) uses the same ones.
COMPOSE    := docker compose -f compose.prod.yaml --env-file .deploy.env
DEPLOY_ENV  = printf "TAG=%s\nPROD_ENV=%s\nPORT=%s\n" "$(TAG)" "$(PROD_ENV)" "$(PORT)" > .deploy.env

SHELL := bash

.DEFAULT_GOAL := help
.PHONY: help install setup dev build start typecheck check env-check intra-check doctor \
        key-list key-save key-use secret-rotate docker-build docker-push docker-up docker-down \
        docker-logs deploy codename version clean

help: ## Show this help
	@echo "42 Shops v$(VERSION) \"$(CODENAME)\"  (env: $(ENV_FILE))"
	@awk 'BEGIN {FS = ":.*## "} /^[a-z-]+:.*## / {printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)

install: ## Install dependencies from the lockfile
	npm ci

setup: install ## Install and create .env.local from the example
	@test -f .env.local || { cp .env.example .env.local && echo "Created .env.local, fill it in then run: make doctor"; }

dev: ## Start the dev server on :3000
	npm run dev

build: ## Production build
	npm run build

start: ## Serve the production build
	npm run start

typecheck: ## Type-check without emitting
	npm run typecheck

check: typecheck build ## Everything CI runs

env-check: ## Required env vars are present and well formed
	@$(ENV) check

intra-check: ## Your 42 app credentials are accepted by intra
	@$(ENV) intra

doctor: env-check intra-check ## env-check + intra-check

key-list: ## List saved 42 API key profiles (* = active)
	@$(ENV) key-list

key-save: ## Save the current 42 key as a profile: make key-save NAME=main
	@$(ENV) key-save $(NAME)

key-use: ## Switch to a saved 42 key and verify it: make key-use NAME=main
	@$(ENV) key-use $(NAME) && $(ENV) intra

secret-rotate: ## New 42 secret: verified with intra, saved, app restarted. Remote: HOST=user@server
	@read -rsp "New FT_CLIENT_SECRET (hidden): " secret; echo; \
	if [ -z "$(HOST)" ]; then \
	  printf '%s' "$$secret" | $(ENV) secret-check && printf '%s' "$$secret" | $(ENV) secret-set || exit 1; \
	  if [ "$(ENV_FILE)" = "$(PROD_ENV)" ] && [ -f .deploy.env ] && [ -n "$$($(COMPOSE) ps -q app 2>/dev/null)" ]; then \
	    $(COMPOSE) up -d --force-recreate app; \
	  else echo "  Restart the dev server to pick it up."; fi; \
	else \
	  id=$$(ssh $(HOST) "sed -n 's/^FT_CLIENT_ID=//p' $(DEPLOY_DIR)/$(PROD_ENV)"); \
	  test -n "$$id" || { echo "  No FT_CLIENT_ID in $(HOST):$(DEPLOY_DIR)/$(PROD_ENV)"; exit 1; }; \
	  printf '%s' "$$secret" | FT_CLIENT_ID="$$id" $(ENV) secret-check || exit 1; \
	  printf '%s\n' "$$secret" | ssh $(HOST) '$(REMOTE_SET_SECRET)'; \
	fi

# Runs on HOST with the secret on stdin, so it never appears in argv or shell history.
REMOTE_SET_SECRET = cd $(DEPLOY_DIR) && read -r s && f=$(PROD_ENV) \
  && { grep -v "^FT_CLIENT_SECRET=" "$$f"; echo "FT_CLIENT_SECRET=$$s"; } > "$$f.new" \
  && cat "$$f.new" > "$$f" && rm "$$f.new" \
  && $(COMPOSE) up -d --force-recreate app \
  && echo "  Secret updated, app restarted on $$(hostname)"

docker-build: ## Build the production image, tagged v<version> and latest
	docker build --build-arg VERSION=$(VERSION) --build-arg CODENAME=$(CODENAME) \
	  -t $(IMAGE):v$(VERSION) -t $(IMAGE):latest .

docker-push: docker-build ## Push the image to GHCR (run `docker login ghcr.io` once)
	docker push $(IMAGE):v$(VERSION)
	docker push $(IMAGE):latest

docker-up: ## Run the image + Redis here from compose.prod.yaml, reading PROD_ENV
	@test -f $(PROD_ENV) || { echo "Create $(PROD_ENV) first (cp .env.example $(PROD_ENV))"; exit 1; }
	$(DEPLOY_ENV)
	$(COMPOSE) up -d

docker-down: ## Stop the local compose.prod.yaml stack
	$(COMPOSE) down

docker-logs: ## Follow the app logs (add HOST=user@server for the remote one)
	$(if $(HOST),ssh $(HOST) 'cd $(DEPLOY_DIR) && $(COMPOSE) logs -f app',$(COMPOSE) logs -f app)

deploy: ## Copy compose.prod.yaml to HOST:DEPLOY_DIR, pull TAG and (re)start it
	@test -n "$(HOST)" || { echo "Usage: make deploy HOST=user@server [DEPLOY_DIR=$(DEPLOY_DIR)] [TAG=$(TAG)]"; exit 2; }
	ssh $(HOST) 'mkdir -p $(DEPLOY_DIR)'
	scp compose.prod.yaml $(HOST):$(DEPLOY_DIR)/compose.prod.yaml
	ssh $(HOST) 'cd $(DEPLOY_DIR) && test -f $(PROD_ENV)' \
	  || { echo "Create $(HOST):$(DEPLOY_DIR)/$(PROD_ENV) first (see .env.example)"; exit 1; }
	ssh $(HOST) 'cd $(DEPLOY_DIR) && $(DEPLOY_ENV) && $(COMPOSE) pull app && $(COMPOSE) up -d'

codename: ## Print the release codename
	@echo $(CODENAME)

version: ## Print the package version
	@echo $(VERSION)

clean: ## Remove build output
	rm -rf .next
