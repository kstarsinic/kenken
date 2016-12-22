angular.module('kenkenApp')
  .service('KenkenSolver', function() {

    // TODO when cage must contain value (eg [2/ 248, 248] must contain 4) and is inline, eliminate value from rest of line

    this.getSolver = function($scope) {

      //
      // MARK: solver variables
      //

      var board;            // the grid
      var boardSize;        // size of grid

      var rows;             // the grid rows
      var columns;          // the grid columns
      var rowsAndColumns;   // = rows.concat(columns)

      var cages;            // math cages in the board, plus new ones we'll make
      var cageExists;       // check this to avoid duplicates when we make new cages

      var rowTotal;         // sum of cells in each row
      var rowProduct;       // product of cells in each row

      var ruleNames = ["singleton", "divisor", "division", "multiplication", "subtraction", "pigeonhole", "addition", "two pair",
        "three", "two and two", "line sum", "line product"];

      var stepIterator;

      var done = false;

      //
      // MARK: main solving routine
      //

      // TODO solver should be an object, with puzzle ($scope) as constructor parameter
      // the main routine
      function *solve() {
        if (done) return;
        var maxPasses = 50;
        for (var numPasses = 1; numPasses < maxPasses; numPasses++) {
          var previousBoard = angular.copy(board);
          for (var ruleIndex = 0; ruleIndex < ruleNames.length; ruleIndex++) {
            var rule = ruleNames[ruleIndex];
            console.log("APPLYING RULE:", rule);
            yield *rules[rule]();
          }
          console.log("Finished pass", numPasses, "through rules");
          if (possiblesMatch(previousBoard)) break;
        }
        console.log("DONE!!!");
        done = true;
        yield null;
      }

      function step() {
        if (!stepIterator) stepIterator = solve();
        return stepIterator.next();
      }

      function solveFully() {
        while (!step().done) {}
      }

      //
      // MARK: initialization and resetting
      //

      // initialize the solver
      function initialize(puzzle) {
        $scope = puzzle;
        board = puzzle.board;
        boardSize = board.length;
        rowTotal = (boardSize + 1) * boardSize / 2;
        rowProduct = factorial(boardSize);

        // make convenience collections rows, columns, rowsAndColumns
        rows = board;
        columns = [];
        for (var j = 0; j < boardSize; j++) {
          columns[j] = [];
          for (var i = 0; i < boardSize; i++) {
            columns[j].push(board[i][j]);
          }
        }
        rowsAndColumns = rows.concat(columns);

        // set up possible values if not already set
        rows.forEach(function (cells) {
          cells.forEach(function (cell) {
            if (!cell.possible) cell.possible = pNew(boardSize);
          })
        });

        resetCages();
      }

      function resetCages() {
        // reset cages
        cages = [];
        cageExists = {};

        // copy puzzle cages to our solver's cage list, with real cells inside instead of coordinates
        $scope.cages.forEach(function (c) {
          var cage = angular.copy(c);
          cage.cells.forEach(function (coords, i) {
            cage.cells[i] = board[coords[0]][coords[1]];
          });
          addCage(cage);
        });
      }

      function reset() {
        // in each cell, reset solution, guess, and possible values
        rows.forEach(function (cells) {
          cells.forEach(function (cell) {
            cell.possible = pNew(boardSize);
            delete cell.solution;
            delete cell.guess;
          })
        });

        resetCages();
        stepIterator = null;

        done = false;
      }

      //
      // MARK: managing possible values in cells
      //

      // check possible values in previous board against current board
      function possiblesMatch(previousBoard) {
        for (var i = 0; i < boardSize; i++) {
          for (var j = 0; j < boardSize; j++) {
            if (!board[i][j].possible.matches(previousBoard[i][j].possible)) return false;
          }
        }
        return true;
      }

      // eliminate possible values in a cell
      function *clear(cell, values, why) {
        if (!(values instanceof Array)) values = [values];
        if (pYes(cell.possible, values)) {
          console.log("%s clear %s: %s", cellName(cell), values.join(","), why);
          $scope.setCursor(cell.i, cell.j);
          yield null;
          pClear(cell.possible, values);
          if (pCount(cell.possible) == 1) {
            yield *solveCell(cell, pFirstValue(cell.possible));
          }
        }
      }

      // set a single value as the only possibility in a cell
      function *setOnly(cell, n, why) {
        if (cell.solution != n) {
          console.log("%s set %d: %s", cellName(cell), n, why);
          $scope.setCursor(cell.i, cell.j);
          yield null;
          pSetOnly(cell.possible, n);
          yield *solveCell(cell, n);
        }
      }

      // set a cell to a particular value, and clear that value from other cells in its row and column
      // if the cell lives in a cage of 3 or more cells, make a smaller cage with the remaining cells
      function *solveCell(cell, n) {
        if (cell.ans != n) console.log("!!!!! WRONG");
        console.log("SOLVED " + cellName(cell) + " = " + n);
        cell.solution = n;
        cell.guess = cell.solution;
        $scope.setCursor(cell.i, cell.j);
        yield null;

        // clear row & column
        yield *rows[cell.i].concat(columns[cell.j]).yieldEach(function*(otherCell) {
          if (!otherCell.solution) {
            pClear(otherCell.possible, n);
            if (pCount(otherCell.possible) == 1) {
              yield *solveCell(otherCell, pFirstValue(otherCell.possible));
            }
          }
        });

        // find unsolved cells in cage, if any
        var cage = cages[cell.cage];
        var newTotal = cage.total;
        var unsolvedCells = cage.cells.filter(function (c) {
          if (c.solution) {
            if (cage.op == '+') newTotal -= c.solution;
            if (cage.op == 'x') newTotal /= c.solution;
          }
          return !c.solution;
        });

        if (unsolvedCells.length == 0) {
          console.log("CAGE SOLVED", cageName(cage));
          cage.solved = true;
        } else if (cage.op == '+' || cage.op == 'x') {
          // if in a + or x cage, make a smaller cage with the unsolved cells
          if (unsolvedCells.length == 1) {
            yield *setOnly(unsolvedCells[0], newTotal, "last cell left in cage", cageName(cage));
          } else if (unsolvedCells.length > 1) {
            var newCage = {op: cage.op, total: newTotal, cells: unsolvedCells};
            addCage(newCage, "leftovers after solving " + cellName(cell) + " = " + n);
          }
        }

      }


      //
      // MARK: managing cages
      //

      // add a cage to the cage list
      function addCage(cage, why) {
        var key = cage.op;
        cage.cells.forEach(function (cell) {
          key += ";" + cell.i + "," + cell.j;
        });
        if (!cageExists[key]) {
          if (why) console.log("NEW CAGE " + cageName(cage) + ": " + why);
          cages.push(cage);
          cageExists[key] = true;
          cage.inLine = cellsInLine(cage.cells);
        }
      }

      // if cells are all in the same row or column, return the line number
      // if they're not in line, return -1
      // line number = row number for rows, boardSize + column number for columns
      function cellsInLine(cells) {
        var i = cells[0].i, j = cells[0].j;
        cells.forEach(function (cell) {
          if (i > -1 && cell.i != i) i = -1;
          if (j > -1 && cell.j != j) j = -1;
        });
        // return a proper index into rowsAndColumns
        if (i > -1) return i;
        else if (j > -1) return boardSize + j;
        else return -1;
      }

      function rowAndColumnPossibles() {
        var possibles = [];
        for (var i = 0; i < boardSize * 2; i++) {
          possibles[i] = pNew(boardSize);
        }
        return possibles;
      }

      function cageCanFinish(op, total, cells, possibles) {
        // if (cells.length == 0 || op != '+' || op != 'x') return false;

        var row = cells[0].i, column = cells[0].j + boardSize;

        function isPossible(value) {
          return pYes(cells[0].possible, value) && pYes(possibles[row], value) && pYes(possibles[column], value);
        }

        if (cells.length == 1) return isPossible(total);

        var otherCells = cells.slice(1);

        for (var n = 1; n <= boardSize; n++) {
          if (isPossible(n)) {
            var remainder = op == '+' ? total - n : total / n;
            if (remainder > 0 && remainder == Math.round(remainder)) {
              pClear(possibles[row], n);
              pClear(possibles[column], n);
              if (cageCanFinish(op, remainder, otherCells, possibles)) return true;
              pSet(possibles[row], n);
              pSet(possibles[column], n);
            }
          }
        }

        return false;

      }

      //
      // MARK: convenient yield loops
      //

      // yield all unsolved cages of type op (to get all unsolved cages, use null op)
      function *yieldCages(op, fn) {
        yield *cages.yieldEach(function*(cage) {
          if (!cage.solved && (!cage.op || cage.op == op)) {
            yield *fn(cage);
          }
        });
      }

      // yield unsolved cells in all unsolved cages of type op (to get all unsolved cages, use null op)
      // fn params are (cage, cell, i), where i is index of cell in cage.cells
      function *yieldCageCells(op, fn) {
        yield *yieldCages(op, function*(cage) {
          yield *cage.cells.yieldEach(function*(cell, i) {
            if (!cell.solution) {
              yield *fn(cage, cell, i);
            }
          });
        });
      }

      //
      // MARK: solver rules
      //

      var rules = {
        "singleton": function*() {
          yield *yieldCages(null, function*(cage) {
            if (cage.cells.length == 1) {
              yield *setOnly(cage.cells[0], cage.total, "singleton cage");
            }
          });
        },

        "divisor": function*() {
          yield *yieldCageCells("x", function*(cage, cell) {
            var nondivisors = [];
            pEach(cell.possible, function (n) {
              if (cage.total % n != 0) nondivisors.push(n);
            });
            if (nondivisors.length > 0) yield *clear(cell, nondivisors, "not a divisor of " + cage.total);
          });
        },

        "addition": function*() {
          // eliminate values that can't complete a multiplication cage
          yield *yieldCages("+", function*(cage) {
            var remainder = cage.total;
            var openCells = [];

            cage.cells.forEach(function (cell) {
              if (cell.solution) remainder -= cell.solution;
              else openCells.push(cell);
            });

            if (openCells.length == 1) {
              yield *solveCell(openCells[0], remainder);
            } else if (openCells.length < 4) {
              yield *openCells.yieldEach(function*(cell) {
                var values = [];
                var otherCells = arraySubtract(openCells, [cell]);
                pEach(cell.possible, function (n) {
                  var possibles = rowAndColumnPossibles();
                  pClear(possibles[cell.i], n);
                  pClear(possibles[cell.j + boardSize], n);
                  if (!cageCanFinish('+', remainder - n, otherCells, possibles)) {
                    values.push(n);
                  }
                  pSet(possibles[cell.i], n);
                  pSet(possibles[cell.j + boardSize], n);
                });
                if (values.length > 0) yield *clear(cell, values, "rest of cage impossible", cage);
              });
            }
          });

        },

        "division": function*() {
          // eliminate values that can't complete a division cage
          yield *yieldCageCells("/", function*(cage, cell, i) {
            var values = [];
            var otherCell = cage.cells[1 - i];
            pEach(cell.possible, function (n) {
              if (!pYes(otherCell.possible, [n * cage.total, n / cage.total])) {
                values.push(n);
              }
            });
            if (values.length > 0) yield *clear(cell, values, "counterpart not possible in other cell");
          });
        },

        "multiplication": function*() {
          // eliminate values that can't complete a multiplication cage
          yield *yieldCages("x", function*(cage) {
            var remainder = cage.total;
            var openCells = [];

            cage.cells.forEach(function (cell) {
              if (cell.solution) remainder /= cell.solution;
              else openCells.push(cell);
            });

            if (openCells.length == 1) {
              yield *solveCell(openCells[0], remainder);
            } else {
              yield *openCells.yieldEach(function*(cell) {
                var values = [];
                pEach(cell.possible, function (n) {
                  var otherCells = arraySubtract(openCells, [cell]);
                  var possibles = rowAndColumnPossibles();
                  pClear(possibles[cell.i], n);
                  pClear(possibles[cell.j + boardSize], n);
                  if (!cageCanFinish('x', remainder / n, otherCells, possibles)) {
                    values.push(n);
                  }
                  pSet(possibles[cell.i], n);
                  pSet(possibles[cell.j + boardSize], n);

                });
                if (values.length > 0) yield *clear(cell, values, "rest of cage impossible");
              });
            }
          });

        },

        "pigeonhole": function*() {
          // If possibility occurs only once in a row or column, it must appear there

          yield *rowsAndColumns.yieldEach(function*(cells, line) {
            var rowOrCol = line < boardSize ? "row" : "column";
            for (var n = 1; n <= boardSize; n++) {
              var count = 0, target = null;
              cells.forEach(function (cell) {
                if (pYes(cell.possible, n)) {
                  count++;
                  target = cell;
                }
              });
              if (count == 1 && !target.solution) {
                yield *setOnly(target, n, "only place left in " + rowOrCol + " for " + n);
              }
            }
          });
        },

        "subtraction": function*() {
          // Check legal subtraction possibilities
          yield* yieldCageCells('-', function*(cage, cell, i) {
            var values = [];
            var otherCell = cage.cells[1 - i];
            pEach(cell.possible, function (n) {
              if (!pYes(otherCell.possible, [n + cage.total, n - cage.total])) {
                values.push(n);
              }
            });
            if (values.length > 0) yield *clear(cell, values, "counterpart not possible in other cell");
          });
        },

        "two pair": function*() {
          // If the possibilities of two cells in the same row or column all equal the same 2
          // numbers, those two numbers must occupy those cells, and therefore aren't possible
          // in any other cells in the same row/column.

          yield *rowsAndColumns.yieldEach(function*(cells, line) {
            var rowOrCol = line < boardSize ? "row" : "column";
            for (var i = 0; i < boardSize - 1; i++) {
              var cellA = cells[i];
              if (pCount(cellA.possible) == 2) {
                for (var j = i + 1; j < boardSize; j++) {
                  var cellB = cells[j];
                  if (cellB.possible.matches(cellA.possible)) {
                    // two-pair found! remove these two values from all other cells
                    var otherCells = arraySubtract(cells, [cellA, cellB]);
                    var v = pValues(cellA.possible);
                    var vals = "" + v[0] + "-" + v[1];
                    var inCells = cellName(cellA) + " & " + cellName(cellB);
                    yield *otherCells.yieldEach(function*(cell) {
                      yield *clear(cell, v, vals + " in this " + rowOrCol + " must be in " + inCells);
                    });
                    // is pair in same cage? cage bigger than 2? then make a subcage with leftover cells
                    if (cellA.cage == cellB.cage && cages[cellA.cage].cells.length > 2) {
                      var cage = cages[cellA.cage];
                      var subCage = {
                        op: cage.op,
                        total: cage.op == '+' ? cage.total - (v[0] + v[1]) : cage.total / (v[0] * v[1]),
                        cells: arraySubtract(cage.cells, [cellA, cellB])
                      };
                      addCage(subCage, "leftovers after pair");
                    }
                  }
                }
              }
            }
          });
        },

        "three": function*() {
          // If the possibilities of three cells in the same row or column all equal the same 3
          // numbers, those three numbers must occupy those cells, and therefore aren't possible
          // in any other cells in the same row/column.

          yield *rowsAndColumns.yieldEach(function*(cells, line) {
            var rowOrCol = line < boardSize ? "row" : "column";
            for (var i = 0; i < boardSize - 2; i++) {
              var cellA = cells[i];
              if (cellA.solution || pCount(cellA.possible) > 3) continue;
              for (var j = i + 1; j < boardSize - 1; j++) {
                var cellB = cells[j];
                if (cellB.solution || pCount(cellB.possible) > 3) continue;
                var possibleAB = pUnion(cellA.possible, cellB.possible);
                if (pCount(possibleAB) > 3) continue;
                for (var k = j + 1; k < boardSize; k++) {
                  var cellC = cells[k];
                  if (cellC.solution || pCount(cellC.possible) > 3) continue;
                  var possibleABC = pUnion(possibleAB, cellC.possible);
                  if (pCount(possibleABC) == 3) {
                    // threesome found! remove these three values from all other cells
                    var otherCells = arraySubtract(cells, [cellA, cellB, cellC]);
                    var v = pValues(possibleABC);
                    var vals = "" + v[0] + "-" + v[1] + "-" + v[2];
                    var inCells = cellName(cellA) + "," + cellName(cellB) + "," + cellName(cellC);
                    yield *otherCells.yieldEach(function*(cell) {
                      yield *clear(cell, v, vals + " in this " + rowOrCol + " must be in " + inCells);
                    });
                  }
                }
              }
            }
          });
        },

        "two and two": function*() {
          // if a value must occupy either column A or B in two different rows,
          // eliminate that value in all other rows of A and B
          var pairs = [];

          yield *[rows, columns].yieldEach(function*(lines) {

            var linesAreRows = lines == rows;
            var crossers = linesAreRows ? columns : rows;
            var lineLabel = linesAreRows ? "row" : "column";
            var crosserLabel = linesAreRows ? "column" : "row";

            // reset pairs
            for (var n = 1; n <= boardSize; n++) pairs[n] = [];

            // scan lines for pairs
            lines.forEach(function (cells, line) {
              // count how many cells each value is possible in
              for (var n = 1; n <= boardSize; n++) {
                var cellsWithValue = [];
                cells.forEach(function (cell, i) {
                  if (pYes(cell.possible, n)) {
                    if (cellsWithValue.length < 3) cellsWithValue.push(i); // don't collect past 3 occurrences
                  }
                });
                // if only two cells have this value, it's a pair! save it
                if (cellsWithValue.length == 2) pairs[n].push({line: line, cells: cellsWithValue});
              }
            });

            // any pair of line pairs share the same crossers?
            for (n = 1; n <= boardSize; n++) {
              if (pairs[n].length > 1) {
                // look for a match
                for (var j = 0; j < pairs[n].length - 1; j++) {
                  for (var k = j + 1; k < pairs[n].length; k++) {
                    var pairA = pairs[n][j], pairB = pairs[n][k];
                    if (pairA.cells.matches(pairB.cells)) {
                      // found one!
                      var why = "this " + crosserLabel + "'s " + n + " must occur in " +
                        lineLabel + " " + pairA.line + " or " + pairB.line;
                      yield *pairA.cells.yieldEach(function*(pairCell) {
                        yield *crossers[pairCell].yieldEach(function*(cell) {
                          var thisLine = linesAreRows ? cell.i : cell.j;
                          if (thisLine != pairA.line && thisLine != pairB.line) {
                            yield *clear(cell, n, why);
                          }
                        });
                      });
                    }
                  }
                }
              }
            }
          });
        },

        // not fully implemented yet
        "must-have divisor": function () {
          var n = boardSize;
          var mustHaveDivisors = n < 6 ? [3, 5] : n > 6 ? [5, 7] : [5];
          cages.forEach(function (cage) {
            if (cage.op == 'x') {
              mustHaveDivisors.forEach(function (d) {
                if (cage.total % d == 0) {
                  // found a must-have divisor! now, does the cage live in one line?
                  var row = cage.cells[0].i;
                  var column = cage.cells[0].j;
                  cage.cells.forEach(function (cell) {
                    row = cell.i == row ? row : false;
                    column = cell.j == column ? column : false;
                  });
                  // if so, divisor is impossible elsewhere in that line
                  if (row) rows[row].forEach(function (cell) {
                    if (cell.cage != cage.id) clear(cell, d, "must have divisor");
                  });
                  if (column) columns[column].forEach(function (cell) {
                    if (cell.cage != cage.id) clear(cell, d, "must have divisor");
                  });
                }
              });
            }
          });
        },

        "line sum": function*() {
          yield *rowsAndColumns.yieldEach(function*(cells, line) {
            var rowOrColumn = line < boardSize ? "row" : "column";
            var remainder = rowTotal;
            for (var i = 0; i < cells.length; i++) {
              var cell = cells[i], cage = cages[cell.cage];
              if (cage.op == '+' && cage.inLine == line) {
                remainder -= cage.total;
                cells = arraySubtract(cells, cage.cells);
                i -= 1; // adjust after cells are dropped
              } else if (cell.solution) {
                remainder -= cell.solution;
                cells = arraySubtract(cells, [cell]);
                i -= 1;
              }
            }
            if (cells.length == 1) {
              yield *setOnly(cells[0], remainder, "remainder of " + rowOrColumn + " sum");
            } else if (cells.length > 1 && cells.length < boardSize / 2) {
              addCage({
                op: '+',
                total: remainder,
                cells: cells
              }, "remainder of " + rowOrColumn + " " + (line % boardSize) + " sum");
            }
          });
        },

        "line product": function*() {
          yield *rowsAndColumns.yieldEach(function*(cells, line) {
            var rowOrColumn = line < boardSize ? "row" : "column";
            var remainder = rowProduct;
            for (var i = 0; i < cells.length; i++) {
              var cell = cells[i], cage = cages[cell.cage];
              if (cage.op == 'x' && cage.inLine == line) {
                remainder /= cage.total;
                cells = arraySubtract(cells, cage.cells);
                i -= 1; // adjust after cells are dropped
              } else if (cell.solution) {
                remainder /= cell.solution;
                cells = arraySubtract(cells, [cell]);
                i -= 1;
              }
            }
            if (cells.length == 1) {
              yield *setOnly(cells[0], remainder, "remainder of " + rowOrColumn + " product");
            } else if (cells.length > 1 && cells.length < boardSize / 2) {
              addCage({
                op: 'x',
                total: remainder,
                cells: cells
              }, "remainder of " + rowOrColumn + " " + (line % boardSize) + " product");
            }
          });
        }

      };

      initialize($scope);
      return {
        solve: solveFully,
        step: step,
        reset: reset
      };
    };

    //
    // MARK: tracking possible values
    //

    // to track possible values we use an array p of length n, where n is the size of the board
    // p[i] == true if i is a possible value in the cell, false otherwise
    // p[0] stores the count of possible values
    // the following functions maintain this

    function pNew(n) {
      var p = [n];
      for (var i = 1; i <= n; i++) p[i] = true;
      return p;
    }
    function pSetAll(p) {
      for (var i = 1; i < p.length; i++) p[i] = true;
      p[0] = p.length - 1;
    }
    function pClearAll(p) {
      for (var i = 1; i < p.length; i++) p[i] = false;
      p[0] = 0;
    }
    function pSet(p, x) {
      if (x instanceof Array) x.forEach(function(k) { pSet(p, k); });
      else if (x > 0 && x < p.length && !p[x]) { p[x] = true; p[0]++; }
    }
    function pClear(p, x) {
      if (x instanceof Array) x.forEach(function(k) { pClear(p, k); });
      else if (x > 0 && x < p.length && p[x]) { p[x] = false; p[0]--; }
    }
    function pSetOnly(p, x) {
      pClearAll(p); pSet(p, x);
    }
    function pYes(p, x) {
      if (x instanceof Array) {
        for (var i = 0; i < x.length; i++) if (pYes(p, x[i])) return true;
        return false;
      } else {
        return (x > 0 && x < p.length && p[x]);
      }
    }
    function pCount(p) {
      return p[0];
    }
    function pEach(p, fn) {
      for (var i = 1; i < p.length; i++) if (p[i]) fn(i);
    }
    function pValues(p) {
      var values = [];
      pEach(p, function(i) { values.push(i); });
      return values;
    }
    function pFirstValue(p) {
      return p.indexOf(true);
    }
    function pUnion(a, b) {
      var p = pNew(Math.max(a.length, b.length) - 1);
      for (var i = 1; i < a.length; i++) if (!a[i] && !b[i]) pClear(p, i);
      return p;
    }
    function pString(p) {
      return pValues(p).join("");
    }

    //
    // MARK: convenience functions
    //

    // string for describing a cell in console output
    function cellName(cell) { return "(" + cell.i + "," + cell.j + ")"; }

    // string for describing a cage in console output
    function cageName(cage) {
      var name = "[" + cage.total + cage.op + " ";
      cage.cells.forEach(function(cell, i) {
        name += (i > 0 ? "," : "") + pString(cell.possible);
      });
      return name + "]";
    }

    //
    // MARK: utility functions
    //

    function factorial(n) {
      if (n < 2) return 1;
      else return n * factorial(n - 1);
    }

    function arraySubtract(a, b) {
      var result = [];
      a.forEach(function(elem) {
        if (b.indexOf(elem) == -1) result.push(elem);
      });
      return result;
    }

    Array.prototype.yieldEach = function*(fn) {
      for (var i = 0; i < this.length; i++) yield* fn(this[i], i);
    };

    Array.prototype.matches = function(b) {
      if (b.length != this.length) return false;
      for (var i = 0; i < this.length; i++) {
        if (b[i] != this[i]) return false;
      }
      return true;
    };


  });