# 42 Shops. Run `make` to list targets.

# Release name, bumped by hand for each release. The GitHub release workflow
# reads it from here (`make codename`) and tags v<package.json version>.
CODENAME := Moulinette

VERSION  := $(shell node -p "require('./package.json').version")
ENV_FILE ?= $(if $(wildcard .env.local),.env.local,.env)
ENV      := ENV_FILE=$(ENV_FILE) node scripts/env.mjs

.DEFAULT_GOAL := help
.PHONY: help install setup dev build start typecheck check env-check intra-check doctor \
        key-list key-save key-use codename version clean

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

codename: ## Print the release codename
	@echo $(CODENAME)

version: ## Print the package version
	@echo $(VERSION)

clean: ## Remove build output
	rm -rf .next
