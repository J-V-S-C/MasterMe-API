# Building a Query Engine

This short book follows the author's order. The introduction defines a query plan.

## Chapter 1: Parse

The parser turns a query into a syntax tree while preserving its predicates.

### Section 1.1: Predicates

A predicate filters rows. The parser keeps its column and operator together.

## Chapter 2: Plan

The planner chooses scans and joins using the parsed predicates and available indexes.

### Section 2.1: Index access

An index scan narrows candidate rows before the remaining predicates are checked.
