# Python
Linting, Debugging, Intellisense, auto-completion, code formatting, rename references, view references, go to definition, and the like
Works on both Windows and Mac.

##Features
* Linting (using PyLint and/or Pep8 with support for configuration files)
* Intellisense and auto completion
* Code formatting (using Autopep8 or yapf, defaults to autopep8, with support for configuration files)
* Renaming
* Viewing references
* Going to definitions
* View signature and similar by hovering over a function or method
* Debugging with support for local & global variables, arguments, expressions, watch window, stack information, break points

* Sorting imports

## Issues, Feedback and Suggestions
[Gitbub Issues](https://github.com/DonJayamanne/pythonVSCode/issues)

## Requirements
* Python is installed on the current system
* Path to Python is assumed to be in the current environment path.
* Pylint is installed for linting (optional, this can be turned off)
* - Install Pylint as follows:
* - pip install pylint
* Pep8 is installed for linting (optional, this can be turned off)
* - pip install pep8
* Autopep8 is installed for code formatting 
* - Install AutoPep8 as follows (ensure pep8 is installed):
* - pip install pep8
* - pip install --upgrade autopep8

![Image of Generate Features](https://raw.githubusercontent.com/DonJayamanne/pythonVSCode/master/images/general.gif)

![Image of Go To Definition](https://raw.githubusercontent.com/DonJayamanne/pythonVSCode/master/images/goToDef.gif)

![Image of Renaming and Find all References](https://raw.githubusercontent.com/DonJayamanne/pythonVSCode/master/images/rename.gif)


## Chang Log
### Version 0.0.4
* Added support for linting using Pylint (configuring pylint is coming soon)
* Added support for sorting Imports (Using the command "Pythong: Sort Imports")
* Added support for code formatting using Autopep8 (configuring autopep8 is coming soon)
* Added ability to view global variables, arguments, add and remove break points
### Version 0.0.3
* Added support for debugging using PDB


## Debugging Instructions
* Use the Python debugger, set the name of the startup program


## Source

[Github](https://github.com/DonJayamanne/pythonVSCode)

                
## License

[MIT](https://raw.githubusercontent.com/DonJayamanne/pythonVSCode/master/LICENSE)
