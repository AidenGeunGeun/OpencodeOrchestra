#!/usr/bin/env bun
import { validatePrePackage } from "./package-checks"

await validatePrePackage()
console.log("Electron package inputs validated")
