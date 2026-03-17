grammar DndDsl

entry Model:
    (World=World);

World:
    'world' name=STRING
    (locations+=Location)*
    (functions+=FunctionDeclaration)*;

//Location
Location:
    'location' name=STRING
    (entry=LocationEntry)?
    (exits+=LocationExit)*
    (variables+=VariableDeclaration)*
    (Description)?
    ('sublocations' sublocations+=Location* 'end')?;
LocationExit:
    'exit' name=STRING 'to' exit=LocationChain identifiers+=Identifier*;
LocationEntry:
    'entry' entry=LocationChain;
LocationChain:
    locations+=[Location:STRING] ('->' locations+=[Location:STRING])*;
Identifier:
    '['property=ID ((':'|'=') value=ConstantExpression)? ']';

/*
//Quest
Quest:
    'quest' name=STRING
    (Description)?
    (objectives+=Objective)*
    (CompleteableEvents)?;

Objective:
    'objective' name=STRING
    (Description)?
    (CompleteableEvents)?;
*/

//Event

//Function
FunctionDeclaration:
    'function' name=ID
    (params+=Parameter)*
    (variables+=VariableDeclaration)*
    (description=STRING)?
    (codeBlock=CodeBlock)?
    'return' (returnValue=(Expression));

FunctionCall:
   'call' ((predefined?='predefined' predefinedTarget=ID) | target=[FunctionDeclaration:ID])  ('with' params+=Expression (',' params+=Expression)*)?;


/*Condition:
    conditions+=Condition (('and'| 'or') conditions+=Condition)*;
ConditionalBlock:
    'when' condition=ConditionExpression 'do' body+=CodeBlock 'end';
ConditionExpression:
    left=ConditionExpression operator=('==' | '!=' | '<' | '>' | '<=' | '>=') right=ConditionExpression
    | value=(ConstantExpression);
CodeBlock://TODO
    body+=FunctionCall*;
*/

CodeBlock:
    (code+=Code)+;
Code:
    FunctionCall
    | VariableAssignment
    ;
//General Declarations
VariableDeclaration:
    'let' name=ID '=' value=(Expression | ObjectDeclaration);
Expression:
    ConstantExpression
    | NumericExpression
    | BoolExpression
    ;
ConstantExpression:
    value=(INT | STRING | BooleanValue);

NumericExpression:
    ('(' parts+=NumericExpression ')' | parts+=NumericExpressionPart)
     (operators+=('+' | '-' | '*' | '/') parts+=NumericExpression)*;
NumericExpressionPart:
    (value=(INT | FunctionCall) | valueReference=[VariableDeclaration:ID]);

BoolExpression:
    ('(' parts+=BoolExpression ')' | parts+=BoolExpressionPart)
     (operators+=('and' | 'or' | 'not') parts+=BoolExpression)*;
BoolExpressionPart:
    (value=(BooleanValue | FunctionCall) | valueReference=[VariableDeclaration:ID]);

ObjectDeclaration:
    'object'
    (variables+=VariableDeclaration)*
    (Description)?
    'end';

VariableAssignment:
    target=[VariableDeclaration:ID] '=' value=(ConstantExpression | ObjectDeclaration | FunctionCall);
Parameter infers VariableDeclaration:
    'param' name=ID ':' type=ID;

//Fragments
fragment Description:
    'description' description=STRING;

/*fragment CompleteableEvents:
    ('enabled' 'on' conditions+=Condition)? 
    ('on' 'completed' handler+=CodeBlock)?
    ('on' 'failed' handler+=CodeBlock)?;
*/


// Terminals
terminal BooleanValue returns boolean:
    ('true' | 'false');


hidden terminal WS: /\s+/;
terminal ID: /[_a-zA-Z][\w_]*/;
terminal INT returns number: /[0-9]+/;
terminal STRING: /"(\\.|[^"\\])*"|'(\\.|[^'\\])*'/;

hidden terminal ML_COMMENT: /\/\*[\s\S]*?\*\//;
hidden terminal SL_COMMENT: /\/\/[^\n\r]*/;
